import { LLMExtractionError } from "./errors.ts";
import { validateAgainstSchema } from "./jsonSchema.ts";
import type { LLMJSONRequest, LLMProvider } from "./provider.ts";

// .env.example 기준 로컬 Ollama류 서버 설정. 환경변수를 여기서 직접 읽지 않고
// 호출부(CLI/컨테이너)가 주입한다 — 시간·환경 암묵 의존을 피하기 위함이다.
export interface OllamaProviderConfig {
  baseUrl: string;
  textModel: string;
  visionModel: string;
}

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
      if (!(error instanceof OllamaHttpError)) throw toExtractionError(error);

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
      messages: [
        { role: "system", content: request.systemPrompt },
        {
          role: "user",
          content: request.userPrompt,
          ...(request.images !== undefined ? { images: request.images } : {}),
        },
      ],
    });

    const payload = (await response.json()) as OllamaChatResponse;
    if (payload.message?.content === undefined) {
      throw new LLMExtractionError("LLM 응답에 message.content가 없습니다", { rawResponse: payload });
    }

    return payload.message.content;
  }

  private async generateRequest<T>(model: string, request: LLMJSONRequest<T>): Promise<string> {
    const response = await this.post("/api/generate", {
      model,
      stream: false,
      format: "json",
      system: request.systemPrompt,
      prompt: request.userPrompt,
      ...(request.images !== undefined ? { images: request.images } : {}),
    });

    const payload = (await response.json()) as OllamaGenerateResponse;
    if (payload.response === undefined) {
      throw new LLMExtractionError("LLM 응답에 response 필드가 없습니다", { rawResponse: payload });
    }

    return payload.response;
  }

  private async post(path: string, body: unknown): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(`${this.config.baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw new LLMExtractionError(`LLM 서버에 연결할 수 없습니다 (${path})`, { cause: error });
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
      throw new LLMExtractionError("LLM 응답이 유효한 JSON이 아닙니다", { cause: error, rawResponse: raw });
    }

    const structural = validateAgainstSchema(value, request.schema);
    if (!structural.valid) {
      throw new LLMExtractionError(
        `LLM 응답이 Schema를 통과하지 못했습니다: ${structural.errors.join("; ")}`,
        { rawResponse: value },
      );
    }

    if (!request.validate(value)) {
      throw new LLMExtractionError("LLM 응답이 추가 검증을 통과하지 못했습니다", { rawResponse: value });
    }

    return value;
  }
}

function toExtractionError(error: unknown): LLMExtractionError {
  if (error instanceof LLMExtractionError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new LLMExtractionError(message, { cause: error });
}
