import assert from "node:assert/strict";
import test from "node:test";

import type { ContextItem } from "../packages/shared/src/index.ts";
import { checkReminders, reminderOffsetMinutes } from "../apps/cli/src/runtime/reminderCheck.ts";

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

test("reminderOffsetMinutes는 metadata 값이 없으면 기본 24시간(1440분)이다", () => {
  assert.equal(reminderOffsetMinutes(scheduleItem({ id: "a" })), 1440);
  assert.equal(reminderOffsetMinutes(scheduleItem({ id: "b", metadata: { reminderOffsetMinutes: 60 } })), 60);
  assert.equal(reminderOffsetMinutes(scheduleItem({ id: "c", metadata: { reminderOffsetMinutes: -5 } })), 1440);
});

test("checkReminders는 오프셋 안에 든 마감만 리마인더 대상으로 잡는다", () => {
  const dueSoon = scheduleItem({
    id: "due-soon",
    deadline: "2026-07-21T23:00:00+09:00", // now로부터 23시간 뒤 — 기본 24시간 오프셋 안
  });
  const dueLater = scheduleItem({
    id: "due-later",
    deadline: "2026-07-25T00:00:00+09:00", // 4일 뒤 — 오프셋 밖
  });

  const result = checkReminders([dueSoon, dueLater], NOW);

  assert.equal(result.dueReminders.length, 1);
  assert.equal(result.dueReminders[0].item.id, "due-soon");
  assert.equal(result.updatedItems.length, 1);
  assert.equal(result.updatedItems[0].metadata.reminderSentForDeadline, "2026-07-21T23:00:00+09:00");
});

test("checkReminders는 같은 마감으로 이미 보낸 리마인더는 다시 잡지 않는다", () => {
  const item = scheduleItem({
    id: "task",
    deadline: "2026-07-21T12:00:00+09:00",
    metadata: { reminderSentForDeadline: "2026-07-21T12:00:00+09:00" },
  });

  assert.deepEqual(checkReminders([item], NOW).dueReminders, []);
});

test("checkReminders는 마감이 옮겨지면 새 마감에 대해 다시 리마인더 대상이 된다", () => {
  const item = scheduleItem({
    id: "task",
    deadline: "2026-07-21T12:00:00+09:00",
    metadata: { reminderSentForDeadline: "2026-07-20T12:00:00+09:00" }, // 이전 마감
  });

  const result = checkReminders([item], NOW);
  assert.equal(result.dueReminders.length, 1);
});

test("checkReminders는 이미 지난 마감, cancelled/done, opportunity를 대상에서 제외한다", () => {
  const past = scheduleItem({ id: "past", deadline: "2020-01-01T00:00:00+09:00" });
  const cancelled = scheduleItem({ id: "cancelled", status: "cancelled", deadline: "2026-07-21T12:00:00+09:00" });
  const opportunity = scheduleItem({ id: "opp", kind: "opportunity", deadline: "2026-07-21T12:00:00+09:00" });
  const noDeadline = scheduleItem({ id: "no-deadline" });

  assert.deepEqual(checkReminders([past, cancelled, opportunity, noDeadline], NOW).dueReminders, []);
});

test("checkReminders는 startAt만 있는 Event도 마감처럼 취급한다", () => {
  const event = scheduleItem({ id: "event", kind: "event", startAt: "2026-07-21T10:00:00+09:00" });

  const result = checkReminders([event], NOW);

  assert.equal(result.dueReminders.length, 1);
  assert.equal(result.dueReminders[0].deadline, "2026-07-21T10:00:00+09:00");
});
