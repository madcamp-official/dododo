import assert from "node:assert/strict";
import test from "node:test";

import type { ContextItem } from "../packages/shared/src/index.ts";
import {
  findDueReminders,
  isReminderRecommendationId,
  markReminderSent,
  reminderOffsetMinutes,
  toReminderRecommendation,
} from "../apps/cli/src/runtime/reminderCheck.ts";

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

test("reminderOffsetMinutes는 metadata 값이 없거나 1 미만이면 기본 24시간(1440분)이다", () => {
  assert.equal(reminderOffsetMinutes(scheduleItem({ id: "a" })), 1440);
  assert.equal(reminderOffsetMinutes(scheduleItem({ id: "b", metadata: { reminderOffsetMinutes: 60 } })), 60);
  assert.equal(reminderOffsetMinutes(scheduleItem({ id: "c", metadata: { reminderOffsetMinutes: -5 } })), 1440);
  // doyeonid 리뷰(PR #66) 3번: 0은 findDueReminders 판정 순서상 절대 발동하지 않는
  // 죽은 값이라 더 이상 유효하지 않다 — 기본값으로 폴백한다.
  assert.equal(reminderOffsetMinutes(scheduleItem({ id: "d", metadata: { reminderOffsetMinutes: 0 } })), 1440);
});

test("findDueReminders는 오프셋 안에 든 마감만 리마인더 대상으로 잡는다(메타데이터는 건드리지 않는다)", () => {
  const dueSoon = scheduleItem({
    id: "due-soon",
    deadline: "2026-07-21T23:00:00+09:00", // now로부터 23시간 뒤 — 기본 24시간 오프셋 안
  });
  const dueLater = scheduleItem({
    id: "due-later",
    deadline: "2026-07-25T00:00:00+09:00", // 4일 뒤 — 오프셋 밖
  });

  const result = findDueReminders([dueSoon, dueLater], NOW);

  assert.equal(result.length, 1);
  assert.equal(result[0].item.id, "due-soon");
  // doyeonid 리뷰(PR #66) 1번: 판정과 "보냄" 커밋을 분리했다 — findDueReminders는
  // 순수 판정만 하고 metadata를 바꾸지 않는다(실제 전달 성공 후에만
  // markReminderSent를 호출자가 명시적으로 적용해야 한다).
  assert.equal(dueSoon.metadata.reminderSentForDeadline, undefined);
});

test("findDueReminders는 같은 마감으로 이미 보낸 리마인더는 다시 잡지 않는다", () => {
  const item = scheduleItem({
    id: "task",
    deadline: "2026-07-21T12:00:00+09:00",
    metadata: { reminderSentForDeadline: "2026-07-21T12:00:00+09:00" },
  });

  assert.deepEqual(findDueReminders([item], NOW), []);
});

test("findDueReminders는 마감이 옮겨지면 새 마감에 대해 다시 리마인더 대상이 된다", () => {
  const item = scheduleItem({
    id: "task",
    deadline: "2026-07-21T12:00:00+09:00",
    metadata: { reminderSentForDeadline: "2026-07-20T12:00:00+09:00" }, // 이전 마감
  });

  const result = findDueReminders([item], NOW);
  assert.equal(result.length, 1);
});

test("findDueReminders는 이미 지난 마감, cancelled/done, opportunity를 대상에서 제외한다", () => {
  const past = scheduleItem({ id: "past", deadline: "2020-01-01T00:00:00+09:00" });
  const cancelled = scheduleItem({ id: "cancelled", status: "cancelled", deadline: "2026-07-21T12:00:00+09:00" });
  const opportunity = scheduleItem({ id: "opp", kind: "opportunity", deadline: "2026-07-21T12:00:00+09:00" });
  const noDeadline = scheduleItem({ id: "no-deadline" });

  assert.deepEqual(findDueReminders([past, cancelled, opportunity, noDeadline], NOW), []);
});

test("findDueReminders는 startAt만 있는 Event도 마감처럼 취급한다", () => {
  const event = scheduleItem({ id: "event", kind: "event", startAt: "2026-07-21T10:00:00+09:00" });

  const result = findDueReminders([event], NOW);

  assert.equal(result.length, 1);
  assert.equal(result[0].deadline, "2026-07-21T10:00:00+09:00");
});

test("markReminderSent는 해당 마감만 발송 완료로 표시하고 다른 필드는 보존한다", () => {
  const item = scheduleItem({ id: "task", deadline: "2026-07-21T12:00:00+09:00", metadata: { location: "301호" } });

  const updated = markReminderSent(item, "2026-07-21T12:00:00+09:00", NOW);

  assert.equal(updated.metadata.reminderSentForDeadline, "2026-07-21T12:00:00+09:00");
  assert.equal(updated.metadata.location, "301호");
  assert.equal(updated.updatedAt, NOW.toISOString());
  // 원본은 그대로다(순수 함수) — 호출자가 실제 전달 성공 후에만 저장해야 한다.
  assert.equal(item.metadata.reminderSentForDeadline, undefined);
});

test("toReminderRecommendation은 id가 reminder-로 시작하는 Recommendation을 만든다", () => {
  const item = scheduleItem({ id: "task-1", title: "운영체제 과제 3" });

  const recommendation = toReminderRecommendation({ item, deadline: "2026-07-25T18:00:00+09:00" }, NOW);

  assert.ok(isReminderRecommendationId(recommendation.id));
  assert.equal(recommendation.contextItemId, "task-1");
  assert.match(recommendation.action, /운영체제 과제 3/);
  assert.match(recommendation.reason, /07\. 25\. 오후 06:00/);
  assert.equal(recommendation.createdAt, NOW.toISOString());
});

test("isReminderRecommendationId는 reminder- 접두사가 있을 때만 true다", () => {
  assert.equal(isReminderRecommendationId("reminder-task-1-1784980800000"), true);
  assert.equal(isReminderRecommendationId("rec-1"), false);
  assert.equal(isReminderRecommendationId(""), false);
});
