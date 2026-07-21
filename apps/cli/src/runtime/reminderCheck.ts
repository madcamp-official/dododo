import { isExcludedContextStatus } from "../../../../packages/context-engine/src/index.ts";
import type { ContextItem } from "../../../../packages/shared/src/index.ts";

// docs/frontend-plan.md 2.4: "기본 24시간 전, Task별 수정 가능". domain 필드로
// 승격하지 않고 metadata에 둔다(snooze.ts/scheduleConflict.ts와 같은 관례) — 공동
// 소유 계약 변경 없이 끝난다.
const DEFAULT_REMINDER_OFFSET_MINUTES = 24 * 60;
const REMINDER_OFFSET_KEY = "reminderOffsetMinutes";
// 값은 "이미 리마인더를 보낸 마감 시각" 자체를 담는다(단순 boolean이 아니라) — 사용자가
// 수정으로 마감을 옮기면 새 마감엔 자동으로 다시 리마인더 대상이 된다.
const REMINDER_SENT_FOR_KEY = "reminderSentForDeadline";

export function reminderOffsetMinutes(item: ContextItem): number {
  const value = item.metadata[REMINDER_OFFSET_KEY];
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : DEFAULT_REMINDER_OFFSET_MINUTES;
}

function targetDeadline(item: ContextItem): string | undefined {
  return item.deadline ?? item.startAt;
}

export interface DueReminder {
  item: ContextItem;
  deadline: string;
}

export interface ReminderCheck {
  dueReminders: DueReminder[];
  updatedItems: ContextItem[];
}

// AGENTS.md: 시간 로직은 now를 주입받는다(시스템 로컬 시간에 암묵적으로 의존하지 않음).
export function checkReminders(items: ContextItem[], now: Date): ReminderCheck {
  const dueReminders: DueReminder[] = [];
  const updatedItems: ContextItem[] = [];

  for (const item of items) {
    if (item.kind !== "task" && item.kind !== "event") continue;
    if (isExcludedContextStatus(item.status)) continue;

    const deadline = targetDeadline(item);
    if (deadline === undefined) continue;
    const deadlineMs = Date.parse(deadline);
    if (Number.isNaN(deadlineMs) || deadlineMs <= now.getTime()) continue;
    if (item.metadata[REMINDER_SENT_FOR_KEY] === deadline) continue;

    const offsetMs = reminderOffsetMinutes(item) * 60_000;
    if (deadlineMs - now.getTime() > offsetMs) continue;

    dueReminders.push({ item, deadline });
    updatedItems.push({
      ...item,
      metadata: { ...item.metadata, [REMINDER_SENT_FOR_KEY]: deadline },
      updatedAt: now.toISOString(),
    });
  }

  return { dueReminders, updatedItems };
}
