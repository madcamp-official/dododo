// docs/frontend-plan.md 6.1/6.5: 모든 IPC 함수는 이 타입 하나로 성공·실패를 통일해서
// 반환한다. Renderer는 항상 { ok } 필드를 보고 분기하면 되고, throw로 예외가 IPC
// 경계를 넘어 Renderer에서 알 수 없는 형태로 나타나는 일이 없다.
export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

export function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}

export function fail(code: string, message: string): Result<never> {
  return { ok: false, error: { code, message } };
}

// 핸들러 본문에서 던진 예외를 "unknown" 코드의 실패로 감싼다. 검증 실패처럼 코드로
// 구분해야 하는 실패는 fn 안에서 fail()을 직접 return하지 말고(throw는 항상 unknown이
// 된다) 호출부에서 미리 걸러 fail()을 바로 반환하는 쪽을 쓴다.
export async function toResult<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return ok(await fn());
  } catch (error) {
    return fail("unknown", error instanceof Error ? error.message : String(error));
  }
}
