import type { Recommendation, UserProfile } from "../../shared/src/index.ts";
import { isWithinQuietHours, nextQuietHoursEnd } from "./quietHours.ts";
import { shouldSuppress } from "./suppress.ts";

export interface NotificationGateResult {
  send: boolean;
  recommendation: Recommendation;
}

// Quiet Hours 안이면 알림을 보내지 않고 suppressedUntil을 구간 종료 시각으로 채운
// 복제본을 돌려준다. 판정은 shouldSuppress(단일 진실 소스)를 그대로 통과시켜서
// suppressedUntil을 채우는 로직과 그걸 읽는 로직이 갈라지지 않게 한다.
export function gateNotification(
  recommendation: Recommendation,
  profile: UserProfile,
  now: Date,
): NotificationGateResult {
  if (!isWithinQuietHours(profile, now)) {
    return { send: true, recommendation };
  }

  const held: Recommendation = {
    ...recommendation,
    suppressedUntil: nextQuietHoursEnd(profile, now).toISOString(),
  };
  return { send: !shouldSuppress(held, now), recommendation: held };
}
