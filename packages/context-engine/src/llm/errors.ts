// LLM 호출·파싱·검증 실패를 나타내는 단일 오류 타입.
// extraction/ 등 호출부는 이 오류를 파이프라인 밖으로 던지지 않고 잡아서
// 해당 RawItem만 빈 결과로 처리한다(다른 Source 처리를 중단하지 않는다).
export interface LLMExtractionErrorOptions {
  rawItemId?: string;
  cause?: unknown;
  rawResponse?: unknown;
}

export class LLMExtractionError extends Error {
  readonly rawItemId?: string;
  readonly rawResponse?: unknown;

  constructor(message: string, options: LLMExtractionErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "LLMExtractionError";
    this.rawItemId = options.rawItemId;
    this.rawResponse = options.rawResponse;
  }
}
