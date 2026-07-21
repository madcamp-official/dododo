// docs/frontend-plan.md 6.5: ipcMain.handle 콜백은 toResult() 경계 밖에서 Renderer가
// 보낸 payload를 바로 읽는다 — payload가 object가 아니거나 필수 필드 타입이 안 맞으면
// 이 지점에서 던진 예외가 Result<T> 계약을 벗어나 Renderer까지 그대로 전파된다(거부된
// Promise). 각 핸들러가 비즈니스 로직을 부르기 전에 이 가드로 먼저 걸러 fail("validation", ...)
// 로만 나가게 한다. electron을 import하지 않는 순수 함수라 node --test로 검증한다.
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}
