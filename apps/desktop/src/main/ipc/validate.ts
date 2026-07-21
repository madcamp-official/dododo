import type { UserProfile } from "../../../../../packages/shared/src/index.ts";

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

// doyeonid 리뷰(PR #60): typeof === "number"만으로는 음수·NaN·Infinity·소수(1.5분 같은
// 값)까지 통과해 그대로 저장된다. 리마인더 오프셋은 "분" 단위 정수만 의미가 있어
// Number.isSafeInteger로 정수·유한·안전 범위를 한 번에 강제한다. IPC 경계(handlers.ts)와
// 비즈니스 로직(add.ts의 submitAdd, scheduleItem.ts의 setReminderOffset) 양쪽에서
// 같은 함수를 재사용해 검증이 갈리지 않게 한다.
export function isValidOffsetMinutes(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

// profile:save 페이로드 검증. 배열 필드는 존재 여부·타입만 확인하고 원소 하나하나는
// 검증하지 않는다 — add:submit 등 다른 핸들러의 얕은 검증 수준과 맞춘다. 다른 validate
// 함수들과 마찬가지로 타입 predicate로 선언해, 이 검증을 통과한 뒤엔 handlers.ts가
// `as unknown as UserProfile` 같은 캐스팅 없이 그대로 UserProfile로 쓸 수 있게 한다
// (dotori235 리뷰, PR #68).
export function isUserProfileShape(value: unknown): value is UserProfile {
  if (
    !isRecord(value)
    || typeof value.school !== "string"
    || typeof value.major !== "string"
    || typeof value.year !== "string"
    || !Array.isArray(value.interests)
    || !Array.isArray(value.activityTypes)
    || !Array.isArray(value.preferredLocations)
    || !Array.isArray(value.explicitConstraints)
  ) {
    return false;
  }
  if (value.quietHours === undefined) return true;
  return (
    isRecord(value.quietHours)
    && typeof value.quietHours.start === "string"
    && typeof value.quietHours.end === "string"
  );
}
