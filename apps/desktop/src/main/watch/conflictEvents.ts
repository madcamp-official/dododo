import type { ScheduleConflict } from "../../../../cli/src/runtime/scheduleConflict.ts";
import type { NotificationEvent } from "../notifier/notificationEvent.ts";

// docs/frontend-plan.md 6.2: conflict는 "즉시 알림"(캐릭터 말풍선) — Renderer가 어느
// item을 열지 정할 수 있게 먼저 겹친 항목(a)의 id를 contextItemId로 둔다.
export function toConflictEvents(conflicts: ScheduleConflict[], now: Date): NotificationEvent[] {
  return conflicts.map(({ a, b }) => ({
    kind: "conflict",
    message: `"${a.title}"와(과) "${b.title}" 일정이 겹칩니다.`,
    contextItemId: a.id,
    createdAt: now.toISOString(),
  }));
}
