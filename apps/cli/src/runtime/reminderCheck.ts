import { isExcludedContextStatus } from "../../../../packages/context-engine/src/index.ts";
import type { ContextItem, Recommendation } from "../../../../packages/shared/src/index.ts";

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
  // doyeonid 리뷰(PR #66) 3번: 0을 허용하면 "마감 시점 알림"을 뜻하는 것처럼 보이지만
  // 아래 findDueReminders의 판정 순서상(마감이 이미 지나면 대상에서 빠짐) 0분 오프셋은
  // 사실상 절대 발동하지 않는 죽은 값이었다 — validate.ts의 isValidOffsetMinutes가
  // 저장 시점에 1 이상만 허용하도록 바뀌었고, 여기 폴백도 같은 하한을 쓴다.
  return typeof value === "number" && Number.isFinite(value) && value >= 1
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

// doyeonid 리뷰(PR #66) 1번: 예전엔 이 함수가 대상 판정과 동시에
// reminderSentForDeadline을 세팅한 updatedItems까지 만들어, 호출부(watchTick.ts)가
// 실제 알림 전달 여부와 무관하게 즉시 저장했다 — 전달 전에 "보냄"으로 기록되면
// Renderer가 아직 구독하지 않았거나 전달 중 오류가 나도 다음 tick부터 영구히
// 빠졌다. 이제 판정(findDueReminders)과 "보냄" 커밋(markReminderSent)을 분리해,
// 호출부가 실제 전달(container.notifier.send)이 성공한 뒤에만 커밋하게 한다.
export function findDueReminders(items: ContextItem[], now: Date): DueReminder[] {
  const dueReminders: DueReminder[] = [];

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
  }

  return dueReminders;
}

export function markReminderSent(item: ContextItem, deadline: string, now: Date): ContextItem {
  return {
    ...item,
    metadata: { ...item.metadata, [REMINDER_SENT_FOR_KEY]: deadline },
    updatedAt: now.toISOString(),
  };
}

const TIME_ZONE = "Asia/Seoul";

function formatDeadline(deadline: string): string {
  const parsed = new Date(deadline);
  if (Number.isNaN(parsed.getTime())) return deadline;
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: TIME_ZONE,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

// doyeonid 리뷰(PR #66) 2번: reminder는 예전에 gateNotification(Quiet Hours)을 거치지
// 않고 곧바로 IPC로 나갔다 — 조용한 시간에도 즉시 말풍선이 뜨고 발송 완료로
// 기록됐다. 일반 Recommendation과 똑같은 파이프라인(gateNotification →
// container.notifier.send → 성공 시에만 커밋)을 타게 하려고 DueReminder를
// Recommendation 모양으로 만든다 — id에 "reminder-" 접두사를 둬서 Notifier 구현체가
// (예: ElectronDesktopNotifier) 일반 추천과 구분해 라우팅할 수 있게 한다.
export function toReminderRecommendation(due: DueReminder, now: Date): Recommendation {
  return {
    id: `reminder-${due.item.id}-${Date.parse(due.deadline)}`,
    contextItemId: due.item.id,
    action: `"${due.item.title}" 마감이 얼마 남지 않았습니다`,
    reason: `마감: ${formatDeadline(due.deadline)}`,
    score: 0,
    evidenceIds: [],
    createdAt: now.toISOString(),
  };
}

export function isReminderRecommendationId(id: string): boolean {
  return id.startsWith("reminder-");
}
