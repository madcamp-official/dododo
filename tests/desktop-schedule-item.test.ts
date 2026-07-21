import assert from "node:assert/strict";
import test from "node:test";

import { submitAdd } from "../apps/desktop/src/main/ipc/add.ts";
import { deleteScheduleItem, updateScheduleItem } from "../apps/desktop/src/main/ipc/scheduleItem.ts";
import { runSync } from "../apps/cli/src/commands/sync.ts";
import { createCliContainer } from "../apps/cli/src/runtime/container.ts";

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

test("updateScheduleItem은 Task 필드를 통째로 교체한다", async () => {
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
  assert.equal(updated?.startAt, "2026-07-28T18:00:00+09:00");
  assert.equal(updated?.metadata.location, "301호");
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
