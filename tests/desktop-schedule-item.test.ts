import assert from "node:assert/strict";
import test from "node:test";

import { submitAdd } from "../apps/desktop/src/main/ipc/add.ts";
import { deleteScheduleItem, setReminderOffset, updateScheduleItem } from "../apps/desktop/src/main/ipc/scheduleItem.ts";
import { runSync } from "../apps/cli/src/commands/sync.ts";
import { createCliContainer } from "../apps/cli/src/runtime/container.ts";
import type { ContextItem } from "../packages/shared/src/index.ts";

const NOW = new Date("2026-07-21T10:00:00+09:00");

async function seededContainer() {
  const container = createCliContainer({ databasePath: ":memory:" });
  await runSync(container);
  const tasks = await container.repository.listContextItems("task");
  const opportunities = await container.repository.listContextItems("opportunity");

  // Fixture Source에는 event kind가 없다 — add:submit으로 하나 만들어 event 수정
  // 케이스를 검증한다(submitAdd 자체는 tests/desktop-ipc.test.ts에서 이미 검증됨).
  const added = await submitAdd(container, { title: "팀 회의", date: "2026-07-25", time: "09:00" }, NOW);
  const eventId = added.ok ? added.data.id : undefined;

  return {
    container,
    taskId: tasks[0]?.id as string,
    eventId: eventId as string,
    opportunityId: opportunities[0]?.id as string,
  };
}

test("updateScheduleItem은 Task 필드를 통째로 교체한다(마감은 deadline에 저장)", async () => {
  const { container, taskId } = await seededContainer();

  const result = await updateScheduleItem(container, taskId, {
    title: "운영체제 과제 3(수정)",
    date: "2026-07-28",
    time: "18:00",
    location: "301호",
  }, NOW);

  assert.equal(result.ok, true);
  const updated = await container.repository.findContextItem(taskId);
  assert.equal(updated?.title, "운영체제 과제 3(수정)");
  assert.equal(updated?.deadline, "2026-07-28T18:00:00+09:00");
  assert.equal(updated?.startAt, undefined);
  assert.equal(updated?.metadata.location, "301호");
});

// doyeonid 리뷰(PR #64): updateScheduleItem이 deadline이 아니라 startAt에 썼을 때
// API는 성공해도 캘린더·우선순위는 갱신되지 않았다 — 실제 소비자(calendar.ts의
// scheduledValue, priority.ts의 deadline ?? startAt)까지 반영되는지 함께 검증한다.
test("Task 마감 수정은 calendar.ts의 scheduledValue에도 새 마감으로 반영된다", async () => {
  const { container, taskId } = await seededContainer();

  await updateScheduleItem(container, taskId, {
    title: "운영체제 과제 3(수정)",
    date: "2026-07-28",
    time: "18:00",
  }, NOW);

  const { getWeekSchedule } = await import("../apps/cli/src/commands/calendar.ts");
  const scheduled = await getWeekSchedule(container, new Date("2026-07-27T00:00:00+09:00"), "Asia/Seoul");
  const entry = scheduled.find((s) => s.item.id === taskId);
  assert.ok(entry !== undefined, "수정된 마감이 이번 주 캘린더에 나타나야 함");
  assert.equal(entry?.at, "2026-07-28T18:00:00+09:00");
});

test("Task 수정은 endTime을 거절한다(Task는 마감 하나뿐)", async () => {
  const { container, taskId } = await seededContainer();

  const result = await updateScheduleItem(container, taskId, {
    title: "제목",
    date: "2026-07-28",
    time: "18:00",
    endTime: "19:00",
  }, NOW);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "validation");
});

test("updateScheduleItem은 Event도 수정할 수 있다", async () => {
  const { container, eventId } = await seededContainer();

  const result = await updateScheduleItem(container, eventId, {
    title: "팀 회의(변경)",
    date: "2026-07-29",
    time: "10:00",
    endTime: "11:00",
  }, NOW);

  assert.equal(result.ok, true);
  const updated = await container.repository.findContextItem(eventId);
  assert.equal(updated?.title, "팀 회의(변경)");
  assert.equal(updated?.startAt, "2026-07-29T10:00:00+09:00");
  assert.equal(updated?.endAt, "2026-07-29T11:00:00+09:00");
});

// 김도현 리뷰(PR #64): Task 쪽은 반대 필드(startAt/endAt)를 지우는데 Event 쪽만
// deadline을 안 건드리면 비대칭이다 — 지금은 Event가 deadline을 갖는 경로가 없어
// 버그는 아니지만, 방어적으로 항상 지워지는지 확인한다.
test("updateScheduleItem은 Event를 수정할 때 deadline 필드를 지운다(대칭 정리)", async () => {
  const { container, eventId } = await seededContainer();
  // 실제로는 Event에 deadline이 채워질 경로가 없지만, 방어 로직 자체를 검증하기
  // 위해 저장소에 직접 deadline이 있는 Event를 만들어 둔다.
  const existing = await container.repository.findContextItem(eventId) as ContextItem;
  await container.repository.saveContextItems([{ ...existing, deadline: "2026-07-01T00:00:00+09:00" }]);

  await updateScheduleItem(container, eventId, {
    title: "팀 회의",
    date: "2026-07-29",
    time: "10:00",
  }, NOW);

  const updated = await container.repository.findContextItem(eventId);
  assert.equal(updated?.deadline, undefined);
});

test("updateScheduleItem은 endTime을 비우면 기존 endAt을 지운다", async () => {
  const { container, eventId } = await seededContainer();

  await updateScheduleItem(container, eventId, {
    title: "팀 회의",
    date: "2026-07-29",
    time: "10:00",
    endTime: "11:00",
  }, NOW);

  const result = await updateScheduleItem(container, eventId, {
    title: "팀 회의",
    date: "2026-07-29",
    time: "10:00",
  }, NOW);

  assert.equal(result.ok, true);
  const updated = await container.repository.findContextItem(eventId);
  assert.equal(updated?.endAt, undefined);
});

test("updateScheduleItem은 존재하지 않는 날짜를 거절한다", async () => {
  const { container, taskId } = await seededContainer();

  const result = await updateScheduleItem(container, taskId, {
    title: "제목",
    date: "2026-02-30",
    time: "10:00",
  }, NOW);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "validation");
});

test("updateScheduleItem은 Opportunity를 거절한다(Task/Event 전용)", async () => {
  const { container, opportunityId } = await seededContainer();

  const result = await updateScheduleItem(container, opportunityId, {
    title: "제목",
    date: "2026-07-28",
    time: "10:00",
  }, NOW);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "validation");
});

test("deleteScheduleItem은 status를 cancelled로 바꾼다(소프트 삭제)", async () => {
  const { container, taskId } = await seededContainer();

  const result = await deleteScheduleItem(container, taskId, NOW);

  assert.equal(result.ok, true);
  const updated = await container.repository.findContextItem(taskId);
  assert.equal(updated?.status, "cancelled");
});

test("deleteScheduleItem은 존재하지 않는 id를 not-found로 보고한다", async () => {
  const { container } = await seededContainer();

  const result = await deleteScheduleItem(container, "no-such-id-xyz", NOW);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "not-found");
});

test("setReminderOffset은 metadata.reminderOffsetMinutes를 갱신한다", async () => {
  const { container, taskId } = await seededContainer();

  const result = await setReminderOffset(container, taskId, 60, NOW);

  assert.equal(result.ok, true);
  const updated = await container.repository.findContextItem(taskId);
  assert.equal(updated?.metadata.reminderOffsetMinutes, 60);
});

test("setReminderOffset은 음수·NaN·Infinity·소수를 거절한다", async () => {
  const { container, taskId } = await seededContainer();

  const negative = await setReminderOffset(container, taskId, -10, NOW);
  assert.equal(negative.ok, false);
  if (negative.ok === false) assert.equal(negative.error.code, "validation");

  const notFinite = await setReminderOffset(container, taskId, Number.NaN, NOW);
  assert.equal(notFinite.ok, false);

  const infinite = await setReminderOffset(container, taskId, Number.POSITIVE_INFINITY, NOW);
  assert.equal(infinite.ok, false);

  const decimal = await setReminderOffset(container, taskId, 1.5, NOW);
  assert.equal(decimal.ok, false);
});

test("setReminderOffset은 Opportunity를 거절한다(Task/Event 전용)", async () => {
  const { container, opportunityId } = await seededContainer();

  const result = await setReminderOffset(container, opportunityId, 60, NOW);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "validation");
});
