import { isExcludedContextStatus } from "../../../../packages/context-engine/src/index.ts";
import type { ContextItem } from "../../../../packages/shared/src/index.ts";

export interface ScheduleConflict {
  a: ContextItem;
  b: ContextItem;
}

// 김도현 리뷰(PR #65): 이 저장소에서 Task는 마감을 startAt이 아니라 deadline에
// 저장한다(calendar.ts의 scheduledValue, priority.ts의 deadlineUrgencyScore와 같은
// 관례 — scheduleItem.ts의 updateScheduleItem도 Task 수정 시 startAt을 항상
// 지운다). 이전엔 startAt만 읽어서 실제 Task ContextItem이 전부 후보에서 걸러져,
// Task가 관련된 충돌(Task-Task, Task-Event)이 전혀 감지되지 않았다.
function scheduledStart(item: ContextItem): string | undefined {
  return item.kind === "event" ? item.startAt : item.deadline;
}

function toRange(item: ContextItem): [number, number] {
  const start = Date.parse(scheduledStart(item) ?? "");
  if (item.endAt === undefined) return [start, start];
  const end = Date.parse(item.endAt);
  return Number.isNaN(end) ? [start, start] : [start, end];
}

// doyeonid 리뷰(PR #65): startAt >= now만 남기면 이미 시작했지만 아직 끝나지 않은
// 구간 일정(예: 09:00~11:00짜리 Event를 10:00에 평가)이 후보에서 빠진다 — 그
// 상태에서 10:30~11:30짜리 새 일정과 실제로 겹쳐도 감지되지 않는다. 구간 일정은
// endAt > now, 순간 일정(마감만 있는 Task 등)은 startAt >= now를 기준으로 남긴다.
function isRelevant(item: ContextItem, now: Date): boolean {
  const [start, end] = toRange(item);
  if (Number.isNaN(start)) return false;
  const isInstant = start === end;
  return isInstant ? start >= now.getTime() : end > now.getTime();
}

// docs/frontend-plan.md 2.1: "일정 충돌 감지"는 순수 시각 비교라 LLM이 필요 없다.
// endAt이 없는 항목(마감만 있는 Task 등)은 순간(zero-duration)으로 취급한다 — 다른
// 항목의 실제 구간 안에 들어갈 때만 충돌로 본다(두 순간이 겹치는 건 정확히 같은
// 시각일 때뿐).
export function findScheduleConflicts(items: ContextItem[], now: Date): ScheduleConflict[] {
  const upcoming = items
    .filter((item) => item.kind === "task" || item.kind === "event")
    .filter((item) => !isExcludedContextStatus(item.status))
    .filter((item) => {
      const start = scheduledStart(item);
      return start !== undefined && !Number.isNaN(Date.parse(start));
    })
    .filter((item) => isRelevant(item, now))
    .sort((a, b) => Date.parse(scheduledStart(a) as string) - Date.parse(scheduledStart(b) as string));

  const conflicts: ScheduleConflict[] = [];
  for (let i = 0; i < upcoming.length; i += 1) {
    for (let j = i + 1; j < upcoming.length; j += 1) {
      if (overlaps(upcoming[i], upcoming[j])) conflicts.push({ a: upcoming[i], b: upcoming[j] });
    }
  }
  return conflicts;
}

function overlaps(a: ContextItem, b: ContextItem): boolean {
  const [aStart, aEnd] = toRange(a);
  const [bStart, bEnd] = toRange(b);
  const aIsInstant = aStart === aEnd;
  const bIsInstant = bStart === bEnd;

  if (aIsInstant && bIsInstant) return aStart === bStart;
  if (aIsInstant) return aStart >= bStart && aStart < bEnd;
  if (bIsInstant) return bStart >= aStart && bStart < aEnd;
  return aStart < bEnd && bStart < aEnd;
}

const CONFLICT_NOTIFIED_KEY = "conflictNotifiedWith";

// doyeonid 리뷰(PR #65): 상대 id만 저장하면 두 일정의 시간이 바뀌어 "새 충돌"이
// 생겨도(예: A/B 충돌 알림 → B를 옮겨 해결 → B를 다시 옮겨 재충돌) 영구히
// 재알림되지 않는다. 두 항목의 현재 구간까지 fingerprint에 포함해, 시간이 조금이라도
// 바뀌면 다른 fingerprint가 되어 다시 알림 대상이 되게 한다. 어느 쪽에서 계산해도
// 같은 문자열이 나오도록 두 항목을 정렬해 합친다.
function pairFingerprint(a: ContextItem, b: ContextItem): string {
  const [aStart, aEnd] = toRange(a);
  const [bStart, bEnd] = toRange(b);
  return [`${a.id}:${aStart}:${aEnd}`, `${b.id}:${bStart}:${bEnd}`].sort().join("|");
}

function notifiedFingerprints(item: ContextItem): string[] {
  const value = item.metadata[CONFLICT_NOTIFIED_KEY];
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function withConflictNotified(item: ContextItem, fingerprint: string, now: Date): ContextItem {
  const existing = notifiedFingerprints(item);
  if (existing.includes(fingerprint)) return item;
  return {
    ...item,
    metadata: { ...item.metadata, [CONFLICT_NOTIFIED_KEY]: [...existing, fingerprint] },
    updatedAt: now.toISOString(),
  };
}

export interface ScheduleConflictCheck {
  // 아직 알리지 않은 쌍만 담는다.
  newConflicts: ScheduleConflict[];
  // newConflicts에 나온 item들의 conflictNotifiedWith가 갱신된 버전 — 호출자가
  // saveContextItems로 커밋해야 다음 tick에 같은 쌍을 또 알리지 않는다.
  updatedItems: ContextItem[];
}

// snooze.ts와 같은 이유로 도메인 필드 대신 metadata에 "이미 알린 fingerprint 목록"을
// 남긴다(domain 필드 승격은 공동 소유 계약 변경 절차 필요). 항목이 수정돼 시간이
// 바뀌면 fingerprint가 달라져 새 쌍으로 취급되고 다시 알린다.
export function checkScheduleConflicts(items: ContextItem[], now: Date): ScheduleConflictCheck {
  const conflicts = findScheduleConflicts(items, now);
  const newConflicts: ScheduleConflict[] = [];
  const updatedById = new Map<string, ContextItem>();

  for (const conflict of conflicts) {
    const fingerprint = pairFingerprint(conflict.a, conflict.b);
    if (notifiedFingerprints(conflict.a).includes(fingerprint)) continue;

    newConflicts.push(conflict);
    const a = updatedById.get(conflict.a.id) ?? conflict.a;
    const b = updatedById.get(conflict.b.id) ?? conflict.b;
    updatedById.set(conflict.a.id, withConflictNotified(a, fingerprint, now));
    updatedById.set(conflict.b.id, withConflictNotified(b, fingerprint, now));
  }

  return { newConflicts, updatedItems: [...updatedById.values()] };
}
