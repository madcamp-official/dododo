import type { DueReminder } from "../../../../cli/src/runtime/reminderCheck.ts";
import type { NotificationEvent } from "../notifier/notificationEvent.ts";

const DEFAULT_TIME_ZONE = "Asia/Seoul";

// docs/frontend-plan.md 2.4/6.2: reminder는 "즉시 알림"(캐릭터 말풍선). calendar.ts와
// 같은 이유로 Intl.DateTimeFormat + 명시적 timeZone을 쓴다(toLocaleString은 실행
// 환경의 시스템 로캘/타임존에 암묵적으로 의존해 테스트가 환경마다 달라진다).
export function toReminderEvents(
  dueReminders: DueReminder[],
  now: Date,
  timeZone: string = DEFAULT_TIME_ZONE,
): NotificationEvent[] {
  return dueReminders.map(({ item, deadline }) => ({
    kind: "reminder",
    message: `"${item.title}" 마감이 얼마 남지 않았습니다 (마감: ${formatDeadline(deadline, timeZone)}).`,
    contextItemId: item.id,
    createdAt: now.toISOString(),
  }));
}

function formatDeadline(deadline: string, timeZone: string): string {
  const parsed = new Date(deadline);
  if (Number.isNaN(parsed.getTime())) return deadline;
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}
