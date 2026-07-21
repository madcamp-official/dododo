import { isExcludedContextStatus } from "../../../../packages/context-engine/src/index.ts";
import type { ContextItem } from "../../../../packages/shared/src/index.ts";

export interface ScheduleConflict {
  a: ContextItem;
  b: ContextItem;
}

// docs/frontend-plan.md 2.1: "일정 충돌 감지"는 순수 시각 비교라 LLM이 필요 없다.
// endAt이 없는 항목(마감만 있는 Task 등)은 순간(zero-duration)으로 취급한다 — 다른
// 항목의 실제 구간 안에 들어갈 때만 충돌로 본다(두 순간이 겹치는 건 정확히 같은
// 시각일 때뿐).
export function findScheduleConflicts(items: ContextItem[], now: Date): ScheduleConflict[] {
  const upcoming = items
    .filter((item) => item.kind === "task" || item.kind === "event")
    .filter((item) => !isExcludedContextStatus(item.status))
    .filter((item) => item.startAt !== undefined && !Number.isNaN(Date.parse(item.startAt)))
    .filter((item) => new Date(item.startAt as string) >= now)
    .sort((a, b) => Date.parse(a.startAt as string) - Date.parse(b.startAt as string));

  const conflicts: ScheduleConflict[] = [];
  for (let i = 0; i < upcoming.length; i += 1) {
    for (let j = i + 1; j < upcoming.length; j += 1) {
      if (overlaps(upcoming[i], upcoming[j])) conflicts.push({ a: upcoming[i], b: upcoming[j] });
    }
  }
  return conflicts;
}

function toRange(item: ContextItem): [number, number] {
  const start = Date.parse(item.startAt as string);
  if (item.endAt === undefined) return [start, start];
  const end = Date.parse(item.endAt);
  return Number.isNaN(end) ? [start, start] : [start, end];
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

function notifiedPeerIds(item: ContextItem): string[] {
  const value = item.metadata[CONFLICT_NOTIFIED_KEY];
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function withConflictNotified(item: ContextItem, peerId: string, now: Date): ContextItem {
  const existing = notifiedPeerIds(item);
  if (existing.includes(peerId)) return item;
  return {
    ...item,
    metadata: { ...item.metadata, [CONFLICT_NOTIFIED_KEY]: [...existing, peerId] },
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

// snooze.ts와 같은 이유로 도메인 필드 대신 metadata에 "이미 알린 상대 id 목록"을 남긴다
// (domain 필드 승격은 공동 소유 계약 변경 절차 필요). 항목이 수정돼 시간이 바뀌면 새
// 쌍이 생길 수 있고, 그 새 쌍은 다시 알린다.
export function checkScheduleConflicts(items: ContextItem[], now: Date): ScheduleConflictCheck {
  const conflicts = findScheduleConflicts(items, now);
  const newConflicts: ScheduleConflict[] = [];
  const updatedById = new Map<string, ContextItem>();

  for (const conflict of conflicts) {
    if (notifiedPeerIds(conflict.a).includes(conflict.b.id)) continue;

    newConflicts.push(conflict);
    const a = updatedById.get(conflict.a.id) ?? conflict.a;
    const b = updatedById.get(conflict.b.id) ?? conflict.b;
    updatedById.set(conflict.a.id, withConflictNotified(a, conflict.b.id, now));
    updatedById.set(conflict.b.id, withConflictNotified(b, conflict.a.id, now));
  }

  return { newConflicts, updatedItems: [...updatedById.values()] };
}
