// docs/frontend-plan.md §6.1/§6.5의 Result<T> 규약. 모든 IPC 핸들러가 성공·실패를
// 이 판별 유니언 하나로 통일해 반환한다 — Renderer가 throw/catch 대신 ok로 분기한다.
export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

export function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}

export function fail(code: string, message: string): Result<never> {
  return { ok: false, error: { code, message } };
}

// IPC 핸들러 로직에서 반복되는 try/catch를 한 곳으로 모은다. 실패 사유를 세분화하고
// 싶은 핸들러는 자체적으로 catch해 더 구체적인 code를 반환하고, 그 외에는 이 래퍼가
// "unknown"으로 처리한다(§6.5의 에러 코드 규약: llm-unavailable/network/not-found/
// validation/unknown 등 소문자-kebab).
export async function runResult<T>(work: () => Promise<T>): Promise<Result<T>> {
  try {
    return ok(await work());
  } catch (error) {
    return fail("unknown", error instanceof Error ? error.message : String(error));
  }
}
