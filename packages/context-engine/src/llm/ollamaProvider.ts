import { LLMExtractionError } from "./errors.ts";
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
// 서버가 Schema 제약을 거부하면(HTTP 오류) /api/generate + format:"json"으로 폴백한다.
// 어느 경로든 모델이 "검증됨"이라고 주장해도 반환 전 항상 Schema를 재검증한다.
export class OllamaProvider implements LLMProvider {
  private readonly config: OllamaProviderConfig;

  constructor(config: OllamaProviderConfig) {
    this.config = config;
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
      // /api/chat이 Schema 제약을 거부(4xx)한 경우에만 /api/generate로 폴백한다.
      // 5xx·timeout·연결 실패는 폴백해도 같은 결과이므로 그대로 재시도 가능 오류로 던진다.
      if (!(error instanceof OllamaHttpError) || error.status >= 500) throw toExtractionError(error);

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

function toExtractionError(error: unknown): LLMExtractionError {
  if (error instanceof LLMExtractionError) return error;
  if (error instanceof OllamaHttpError) {
    return new LLMExtractionError(error.message, {
      category: error.status >= 500 ? "server_error" : "client_error",
      cause: error,
    });
  }
  const message = error instanceof Error ? error.message : String(error);
  return new LLMExtractionError(message, { category: "unknown", cause: error });
}
