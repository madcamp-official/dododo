import { LLMExtractionError } from "./errors.ts";
import type { LLMErrorCategory } from "./errors.ts";
import { validateAgainstSchema } from "./jsonSchema.ts";
import type { LLMJSONRequest, LLMProvider } from "./provider.ts";

// .env.example 기준 로컬 Ollama류 서버 설정. 환경변수를 여기서 직접 읽지 않고
// 호출부(CLI/컨테이너)가 주입한다 — 시간·환경 암묵 의존을 피하기 위함이다.
export interface OllamaProviderConfig {
  baseUrl: string;
  textModel: string;
  visionModel: string;
  // 요청별 timeoutMs가 없을 때 쓰는 기본 상한. 기본 30초.
  defaultTimeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 2_147_483_647;

class OllamaHttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "OllamaHttpError";
    this.status = status;
  }
}

interface OllamaChatResponse {
  message?: { content?: string };
}

interface OllamaGenerateResponse {
  response?: string;
}

// Ollama 호환 로컬 서버 Provider. 구조화 출력을 우선 /api/chat + format:<schema>로 요청하고,
// 서버가 Schema 제약을 거부하면(일부 HTTP 4xx) /api/generate + format:"json"으로 폴백한다.
// 어느 경로든 모델이 "검증됨"이라고 주장해도 반환 전 항상 Schema를 재검증한다.
export class OllamaProvider implements LLMProvider {
  private readonly config: OllamaProviderConfig;

  constructor(config: OllamaProviderConfig) {
    if (config.defaultTimeoutMs !== undefined) validateTimeoutMs(config.defaultTimeoutMs, "defaultTimeoutMs");
    this.config = { ...config };
  }

  async completeJSON<T>(request: LLMJSONRequest<T>): Promise<T> {
    const model = request.modelKind === "vision" ? this.config.visionModel : this.config.textModel;
    const raw = await this.callModel(model, request);
    return this.parseAndValidate(raw, request);
  }

  private async callModel<T>(model: string, request: LLMJSONRequest<T>): Promise<string> {
    try {
      return await this.chatRequest(model, request);
    } catch (error) {
      // Schema·endpoint 미지원 가능성이 있는 400·404·422에서만 /api/generate로 폴백한다.
      // 인증 실패, 408·429, 5xx는 같은 서버에 요청을 더 보내지 않고 원래 오류를 전달한다.
      if (!(error instanceof OllamaHttpError) || !shouldFallbackToGenerate(error.status)) {
        throw toExtractionError(error);
      }

      try {
        return await this.generateRequest(model, request);
      } catch (fallbackError) {
        throw toExtractionError(fallbackError);
      }
    }
  }

  private async chatRequest<T>(model: string, request: LLMJSONRequest<T>): Promise<string> {
    const response = await this.post("/api/chat", {
      model,
      stream: false,
      format: request.schema,
      ...temperatureOption(request.temperature),
      messages: [
        { role: "system", content: request.systemPrompt },
        {
          role: "user",
          content: request.userPrompt,
          ...(request.images !== undefined ? { images: request.images } : {}),
        },
      ],
    }, request.timeoutMs);

    const payload = (await response.json()) as OllamaChatResponse;
    if (payload.message?.content === undefined) {
      throw new LLMExtractionError("LLM 응답에 message.content가 없습니다", {
        category: "no_content",
        rawResponse: payload,
      });
    }

    return payload.message.content;
  }

  private async generateRequest<T>(model: string, request: LLMJSONRequest<T>): Promise<string> {
    const response = await this.post("/api/generate", {
      model,
      stream: false,
      format: "json",
      ...temperatureOption(request.temperature),
      system: request.systemPrompt,
      prompt: request.userPrompt,
      ...(request.images !== undefined ? { images: request.images } : {}),
    }, request.timeoutMs);

    const payload = (await response.json()) as OllamaGenerateResponse;
    if (payload.response === undefined) {
      throw new LLMExtractionError("LLM 응답에 response 필드가 없습니다", {
        category: "no_content",
        rawResponse: payload,
      });
    }

    return payload.response;
  }

  private async post(path: string, body: unknown, timeoutMs?: number): Promise<Response> {
    const limit = timeoutMs ?? this.config.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    validateTimeoutMs(limit, timeoutMs === undefined ? "defaultTimeoutMs" : "timeoutMs");
    let response: Response;
    try {
      response = await fetch(`${this.config.baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(limit),
      });
    } catch (error) {
      if (isTimeoutError(error)) {
        throw new LLMExtractionError(`LLM 요청이 시간 초과됐습니다 (${path}, ${limit}ms)`, {
          category: "timeout",
          cause: error,
        });
      }
      throw new LLMExtractionError(`LLM 서버에 연결할 수 없습니다 (${path})`, {
        category: "connection",
        cause: error,
      });
    }

    if (!response.ok) {
      throw new OllamaHttpError(response.status, `LLM 서버가 오류를 반환했습니다 (${path}, ${response.status})`);
    }

    return response;
  }

  private parseAndValidate<T>(raw: string, request: LLMJSONRequest<T>): T {
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch (error) {
      throw new LLMExtractionError("LLM 응답이 유효한 JSON이 아닙니다", {
        category: "invalid_output",
        cause: error,
        rawResponse: raw,
      });
    }

    const structural = validateAgainstSchema(value, request.schema);
    if (!structural.valid) {
      throw new LLMExtractionError(
        `LLM 응답이 Schema를 통과하지 못했습니다: ${structural.errors.join("; ")}`,
        { category: "invalid_output", rawResponse: value },
      );
    }

    if (!request.validate(value)) {
      throw new LLMExtractionError("LLM 응답이 추가 검증을 통과하지 못했습니다", {
        category: "invalid_output",
        rawResponse: value,
      });
    }

    return value;
  }
}

function temperatureOption(temperature: number | undefined): { options?: { temperature: number } } {
  return temperature === undefined ? {} : { options: { temperature } };
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

function validateTimeoutMs(value: number, field: "defaultTimeoutMs" | "timeoutMs"): void {
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_TIMEOUT_MS) {
    throw new LLMExtractionError(
      `${field}는 1 이상 ${MAX_TIMEOUT_MS} 이하의 정수여야 합니다`,
      { category: "client_error" },
    );
  }
}

function shouldFallbackToGenerate(status: number): boolean {
  return status === 400 || status === 404 || status === 422;
}

function categoryForHttpStatus(status: number): LLMErrorCategory {
  if (status === 408) return "timeout";
  if (status === 429) return "rate_limited";
  return status >= 500 ? "server_error" : "client_error";
}

function toExtractionError(error: unknown): LLMExtractionError {
  if (error instanceof LLMExtractionError) return error;
  if (error instanceof OllamaHttpError) {
    return new LLMExtractionError(error.message, {
      category: categoryForHttpStatus(error.status),
      cause: error,
    });
  }
  const message = error instanceof Error ? error.message : String(error);
  return new LLMExtractionError(message, { category: "unknown", cause: error });
}
