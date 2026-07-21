import assert from "node:assert/strict";
import test from "node:test";

import type { ContextItem } from "../packages/shared/src/index.ts";
import { checkScheduleConflicts, findScheduleConflicts } from "../apps/cli/src/runtime/scheduleConflict.ts";

const NOW = new Date("2026-07-21T00:00:00+09:00");

function scheduleItem(overrides: Partial<ContextItem> & { id: string }): ContextItem {
  return {
    kind: "task",
    title: overrides.id,
    status: "confirmed",
    requirements: [],
    tags: [],
    priority: 0,
    confidence: 1,
    evidenceIds: [],
    metadata: {},
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides,
  };
}

test("findScheduleConflicts는 시간대가 겹치는 두 Event를 찾는다", () => {
  const a = scheduleItem({ id: "a", kind: "event", startAt: "2026-07-25T10:00:00+09:00", endAt: "2026-07-25T11:00:00+09:00" });
  const b = scheduleItem({ id: "b", kind: "event", startAt: "2026-07-25T10:30:00+09:00", endAt: "2026-07-25T11:30:00+09:00" });

  const conflicts = findScheduleConflicts([a, b], NOW);

  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].a.id, "a");
  assert.equal(conflicts[0].b.id, "b");
});

test("findScheduleConflicts는 겹치지 않는 일정은 무시한다", () => {
  const a = scheduleItem({ id: "a", kind: "event", startAt: "2026-07-25T10:00:00+09:00", endAt: "2026-07-25T11:00:00+09:00" });
  const b = scheduleItem({ id: "b", kind: "event", startAt: "2026-07-25T11:00:00+09:00", endAt: "2026-07-25T12:00:00+09:00" });

  assert.deepEqual(findScheduleConflicts([a, b], NOW), []);
});

test("findScheduleConflicts는 endAt 없는 마감(순간)이 다른 일정 구간 안에 있으면 충돌로 본다", () => {
  const deadline = scheduleItem({ id: "task", kind: "task", startAt: "2026-07-25T10:30:00+09:00" });
  const event = scheduleItem({ id: "event", kind: "event", startAt: "2026-07-25T10:00:00+09:00", endAt: "2026-07-25T11:00:00+09:00" });

  const conflicts = findScheduleConflicts([deadline, event], NOW);

  assert.equal(conflicts.length, 1);
});

test("findScheduleConflicts는 순간끼리는 정확히 같은 시각일 때만 충돌로 본다", () => {
  const a = scheduleItem({ id: "a", startAt: "2026-07-25T10:00:00+09:00" });
  const b = scheduleItem({ id: "b", startAt: "2026-07-25T10:00:01+09:00" });

  assert.deepEqual(findScheduleConflicts([a, b], NOW), []);

  const c = scheduleItem({ id: "c", startAt: "2026-07-25T10:00:00+09:00" });
  assert.equal(findScheduleConflicts([a, c], NOW).length, 1);
});

test("findScheduleConflicts는 과거 일정과 cancelled/done 상태는 제외한다", () => {
  const past = scheduleItem({ id: "past", kind: "event", startAt: "2020-01-01T10:00:00+09:00", endAt: "2020-01-01T11:00:00+09:00" });
  const overlapPast = scheduleItem({ id: "overlap-past", kind: "event", startAt: "2020-01-01T10:30:00+09:00", endAt: "2020-01-01T11:30:00+09:00" });
  const cancelled = scheduleItem({ id: "cancelled", kind: "event", status: "cancelled", startAt: "2026-07-25T10:00:00+09:00", endAt: "2026-07-25T11:00:00+09:00" });
  const overlapCancelled = scheduleItem({ id: "overlap-cancelled", kind: "event", startAt: "2026-07-25T10:30:00+09:00", endAt: "2026-07-25T11:30:00+09:00" });

  assert.deepEqual(findScheduleConflicts([past, overlapPast, cancelled, overlapCancelled], NOW), []);
});

test("checkScheduleConflicts는 같은 쌍을 두 번 알리지 않는다", () => {
  const a = scheduleItem({ id: "a", kind: "event", startAt: "2026-07-25T10:00:00+09:00", endAt: "2026-07-25T11:00:00+09:00" });
  const b = scheduleItem({ id: "b", kind: "event", startAt: "2026-07-25T10:30:00+09:00", endAt: "2026-07-25T11:30:00+09:00" });

  const first = checkScheduleConflicts([a, b], NOW);
  assert.equal(first.newConflicts.length, 1);
  assert.equal(first.updatedItems.length, 2);

  const updatedA = first.updatedItems.find((item) => item.id === "a") as ContextItem;
  const updatedB = first.updatedItems.find((item) => item.id === "b") as ContextItem;
  assert.deepEqual(updatedA.metadata.conflictNotifiedWith, ["b"]);
  assert.deepEqual(updatedB.metadata.conflictNotifiedWith, ["a"]);

  const second = checkScheduleConflicts([updatedA, updatedB], NOW);
  assert.deepEqual(second.newConflicts, []);
  assert.deepEqual(second.updatedItems, []);
});
