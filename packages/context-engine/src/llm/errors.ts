// LLM 호출·파싱·검증 실패를 나타내는 단일 오류 타입.
// extraction/ 등 호출부는 이 오류를 파이프라인 밖으로 던지지 않고 잡아서
// 해당 RawItem만 빈 결과로 처리한다(다른 Source 처리를 중단하지 않는다).
//
// category는 백그라운드 작업자가 "재시도할지 / 영구 실패로 볼지"를 판정하는 근거다
// (docs/llm-architecture.md §2.3). 지금은 동기 호출부가 이 값을 무시해도 되지만,
// watch/Job Queue가 도입되면 재시도·Dead Letter 정책의 입력이 된다.
export type LLMErrorCategory =
  // 재시도하면 성공할 수 있는 일시적 실패
  | "connection" // 서버에 연결 실패(DNS·연결 거부)
  | "timeout" // 요청 시간 초과
  | "server_error" // HTTP 5xx
  | "rate_limited" // HTTP 429
  // 재시도해도 같은 결과인 영구 실패
  | "client_error" // HTTP 4xx(잘못된 요청)
  | "invalid_output" // JSON 파싱 실패·Schema 불일치·validate 실패
  | "no_content" // 응답에 본문 필드가 없음
  | "unknown";

const RETRYABLE: ReadonlySet<LLMErrorCategory> = new Set([
  "connection",
  "timeout",
  "server_error",
  "rate_limited",
]);

export function isRetryableCategory(category: LLMErrorCategory): boolean {
  return RETRYABLE.has(category);
}

export interface LLMExtractionErrorOptions {
  category?: LLMErrorCategory;
  rawItemId?: string;
  cause?: unknown;
  rawResponse?: unknown;
}

export class LLMExtractionError extends Error {
  readonly category: LLMErrorCategory;
  readonly rawItemId?: string;
  readonly rawResponse?: unknown;

  constructor(message: string, options: LLMExtractionErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "LLMExtractionError";
    this.category = options.category ?? "unknown";
    this.rawItemId = options.rawItemId;
    this.rawResponse = options.rawResponse;
  }

  get retryable(): boolean {
    return isRetryableCategory(this.category);
  }
}
