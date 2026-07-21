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

test("findScheduleConflicts는 이미 진행 중인 구간 일정과 겹치는 새 일정을 감지한다(doyeonid 리뷰 PR #65)", () => {
  const now = new Date("2026-07-25T10:00:00+09:00");
  const inProgress = scheduleItem({ id: "a", kind: "event", startAt: "2026-07-25T09:00:00+09:00", endAt: "2026-07-25T11:00:00+09:00" });
  const newlySynced = scheduleItem({ id: "b", kind: "event", startAt: "2026-07-25T10:30:00+09:00", endAt: "2026-07-25T11:30:00+09:00" });

  const conflicts = findScheduleConflicts([inProgress, newlySynced], now);

  assert.equal(conflicts.length, 1);
});

test("findScheduleConflicts는 endAt이 이미 지난 구간 일정은 제외한다", () => {
  const now = new Date("2026-07-25T11:00:00+09:00");
  const ended = scheduleItem({ id: "a", kind: "event", startAt: "2026-07-25T09:00:00+09:00", endAt: "2026-07-25T11:00:00+09:00" });
  const upcoming = scheduleItem({ id: "b", kind: "event", startAt: "2026-07-25T10:30:00+09:00", endAt: "2026-07-25T11:30:00+09:00" });

  assert.deepEqual(findScheduleConflicts([ended, upcoming], now), []);
});

test("findScheduleConflicts는 겹치지 않는 일정은 무시한다", () => {
  const a = scheduleItem({ id: "a", kind: "event", startAt: "2026-07-25T10:00:00+09:00", endAt: "2026-07-25T11:00:00+09:00" });
  const b = scheduleItem({ id: "b", kind: "event", startAt: "2026-07-25T11:00:00+09:00", endAt: "2026-07-25T12:00:00+09:00" });

  assert.deepEqual(findScheduleConflicts([a, b], NOW), []);
});

// 김도현 리뷰(PR #65): 이 테스트가 원래 startAt을 직접 채운 Task fixture로 "통과"했지만,
// 실제 시스템은 Task 마감을 deadline에 저장한다(startAt이 아니다) — 그래서 실제로는
// 이 필터를 절대 통과하지 못하는 버그를 테스트가 가리고 있었다. deadline으로 고친다.
test("findScheduleConflicts는 endAt 없는 마감(순간, Task는 deadline)이 다른 일정 구간 안에 있으면 충돌로 본다", () => {
  const deadline = scheduleItem({ id: "task", kind: "task", deadline: "2026-07-25T10:30:00+09:00" });
  const event = scheduleItem({ id: "event", kind: "event", startAt: "2026-07-25T10:00:00+09:00", endAt: "2026-07-25T11:00:00+09:00" });

  const conflicts = findScheduleConflicts([deadline, event], NOW);

  assert.equal(conflicts.length, 1);
});

test("findScheduleConflicts는 순간끼리는 정확히 같은 시각일 때만 충돌로 본다(Task는 deadline)", () => {
  const a = scheduleItem({ id: "a", deadline: "2026-07-25T10:00:00+09:00" });
  const b = scheduleItem({ id: "b", deadline: "2026-07-25T10:00:01+09:00" });

  assert.deepEqual(findScheduleConflicts([a, b], NOW), []);

  const c = scheduleItem({ id: "c", deadline: "2026-07-25T10:00:00+09:00" });
  assert.equal(findScheduleConflicts([a, c], NOW).length, 1);
});

// 김도현 리뷰(PR #65)가 직접 지적한 시나리오: 실제 Task ContextItem(startAt 없이
// deadline만 있는)이 후보 필터를 통과해 다른 Task와도 충돌로 잡히는지 확인한다.
test("findScheduleConflicts는 Task-Task 충돌도 감지한다(실제 Task는 startAt이 없다)", () => {
  const a = scheduleItem({ id: "a", kind: "task", deadline: "2026-07-25T10:00:00+09:00" });
  const b = scheduleItem({ id: "b", kind: "task", deadline: "2026-07-25T10:00:00+09:00" });
  assert.equal(a.startAt, undefined);
  assert.equal(b.startAt, undefined);

  const conflicts = findScheduleConflicts([a, b], NOW);

  assert.equal(conflicts.length, 1);
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
  // fingerprint에는 두 항목의 시간까지 포함된다(어느 쪽에서 봐도 같은 문자열) —
  // 상대 id만 저장했던 이전 방식과 달리 시간이 바뀌면 다시 알린다(아래 별도 테스트).
  const fingerprintA = (updatedA.metadata.conflictNotifiedWith as string[])[0];
  const fingerprintB = (updatedB.metadata.conflictNotifiedWith as string[])[0];
  assert.equal(fingerprintA, fingerprintB);
  assert.match(fingerprintA, /^a:\d+:\d+\|b:\d+:\d+$/);

  const second = checkScheduleConflicts([updatedA, updatedB], NOW);
  assert.deepEqual(second.newConflicts, []);
  assert.deepEqual(second.updatedItems, []);
});

test("checkScheduleConflicts는 같은 쌍의 시간이 바뀌면 다시 알린다(doyeonid 리뷰 PR #65)", () => {
  const a = scheduleItem({ id: "a", kind: "event", startAt: "2026-07-25T10:00:00+09:00", endAt: "2026-07-25T11:00:00+09:00" });
  const b = scheduleItem({ id: "b", kind: "event", startAt: "2026-07-25T10:30:00+09:00", endAt: "2026-07-25T11:30:00+09:00" });

  const first = checkScheduleConflicts([a, b], NOW);
  const notifiedA = first.updatedItems.find((item) => item.id === "a") as ContextItem;
  const notifiedB = first.updatedItems.find((item) => item.id === "b") as ContextItem;

  // 변경 없는 재검사는 억제된다.
  assert.deepEqual(checkScheduleConflicts([notifiedA, notifiedB], NOW).newConflicts, []);

  // B가 옮겨졌다가(해결) 다시 겹치는 시간으로 이동한다 — metadata(conflictNotifiedWith
  // 포함)는 보존한 채로(scheduleItem.ts의 updateScheduleItem이 항상 하는 방식).
  const movedAway: ContextItem = { ...notifiedB, startAt: "2026-07-25T12:00:00+09:00", endAt: "2026-07-25T13:00:00+09:00" };
  assert.deepEqual(checkScheduleConflicts([notifiedA, movedAway], NOW).newConflicts, []);

  const movedBack: ContextItem = { ...notifiedB, startAt: "2026-07-25T10:15:00+09:00", endAt: "2026-07-25T11:15:00+09:00" };
  const again = checkScheduleConflicts([notifiedA, movedBack], NOW);
  assert.equal(again.newConflicts.length, 1, "시간이 바뀌어 새로 생긴 충돌은 다시 알려야 함");
});
