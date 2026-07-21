import assert from "node:assert/strict";
import test from "node:test";

import { submitAdd } from "../apps/desktop/src/main/ipc/add.ts";
import { askQuestion } from "../apps/desktop/src/main/ipc/ask.ts";
import { getCalendar, getInbox, getToday } from "../apps/desktop/src/main/ipc/context.ts";
import { runSync as runSyncIpc } from "../apps/desktop/src/main/ipc/sync.ts";
import { completeTask, getTaskDetail, snoozeTask } from "../apps/desktop/src/main/ipc/task.ts";
import { runSync } from "../apps/cli/src/commands/sync.ts";
import { createCliContainer } from "../apps/cli/src/runtime/container.ts";

const NOW = new Date("2026-07-21T10:00:00+09:00");

async function seededContainer() {
  const container = createCliContainer({ databasePath: ":memory:" });
  await runSync(container);
  const tasks = await container.repository.listContextItems("task");
  const opportunities = await container.repository.listContextItems("opportunity");
  return { container, taskId: tasks[0]?.id as string, opportunityId: opportunities[0]?.id as string };
}

test("getToday는 Task/Event를 추천 점수순으로 반환한다", async () => {
  const { container } = await seededContainer();

  const result = await getToday(container, NOW);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.data.items.length > 0);
  for (const ranked of result.data.items) {
    assert.ok(ranked.item.kind === "task" || ranked.item.kind === "event");
    assert.equal(typeof ranked.score, "number");
    assert.equal(typeof ranked.reason, "string");
  }
});

test("getInbox는 Opportunity를 추천 점수순으로 반환한다", async () => {
  const { container } = await seededContainer();

  const result = await getInbox(container, NOW);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.data.items.length > 0);
  for (const ranked of result.data.items) assert.equal(ranked.item.kind, "opportunity");
});

test("getCalendar는 CLI calendar week와 같은 주간 필터를 쓴다", async () => {
  const { container } = await seededContainer();

  const result = await getCalendar(container, NOW, "Asia/Seoul");

  assert.equal(result.ok, true);
  if (!result.ok) return;
  for (const scheduled of result.data.items) {
    assert.equal(typeof scheduled.at, "string");
    assert.ok(!Number.isNaN(Date.parse(scheduled.at)));
  }
});

test("askQuestion은 빈 질문을 거절한다", async () => {
  const { container } = await seededContainer();

  const result = await askQuestion(container, "   ", NOW);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "validation");
});

test("askQuestion은 Context 기반 답변과 근거를 반환한다", async () => {
  const { container } = await seededContainer();

  const result = await askQuestion(container, "오늘 뭐부터 해야 해?", NOW);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(typeof result.data.answer, "string");
  assert.ok(result.data.answer.length > 0);
  assert.deepEqual(result.data.evidenceIds, result.data.evidence.map((evidence) => evidence.id));
});

test("getTaskDetail은 Task와 Evidence를 함께 반환한다", async () => {
  const { container, taskId } = await seededContainer();

  const result = await getTaskDetail(container, taskId, NOW);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.item.id, taskId);
  assert.ok(Array.isArray(result.data.evidence));
  assert.equal(result.data.isSnoozed, false);
});

test("getTaskDetail은 존재하지 않는 id를 not-found로 보고한다", async () => {
  const { container } = await seededContainer();

  const result = await getTaskDetail(container, "no-such-id-xyz", NOW);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "not-found");
});

test("completeTask는 Task 상태를 done으로 바꾼다", async () => {
  const { container, taskId } = await seededContainer();

  const result = await completeTask(container, taskId, NOW);
  assert.equal(result.ok, true);

  const updated = await container.repository.findContextItem(taskId);
  assert.equal(updated?.status, "done");
});

test("completeTask는 Task가 아닌 항목을 거절한다", async () => {
  const { container, opportunityId } = await seededContainer();

  const result = await completeTask(container, opportunityId, NOW);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "validation");
});

test("snoozeTask는 지정 시각까지 Snooze하고, 잘못된 시각은 거절한다", async () => {
  const { container, taskId } = await seededContainer();

  const okResult = await snoozeTask(container, taskId, "2026-07-25T00:00:00+09:00", NOW);
  assert.equal(okResult.ok, true);
  const updated = await container.repository.findContextItem(taskId);
  assert.equal(updated?.metadata.snoozedUntil, new Date("2026-07-25T00:00:00+09:00").toISOString());

  const invalid = await snoozeTask(container, taskId, "이상한 시각", NOW);
  assert.equal(invalid.ok, false);
  if (invalid.ok) return;
  assert.equal(invalid.error.code, "validation");
});

test("submitAdd는 구조화된 값을 파싱 없이 그대로 저장한다", async () => {
  const container = createCliContainer({ databasePath: ":memory:" });

  const result = await submitAdd(container, {
    title: "팀 회의",
    date: "2026-07-25",
    time: "14:00",
    endTime: "15:00",
    location: "학생회관 401호",
    reminderOffsetMinutes: 60,
  }, NOW);

  assert.equal(result.ok, true);
  if (!result.ok) return;

  const saved = await container.repository.findContextItem(result.data.id);
  assert.equal(saved?.title, "팀 회의");
  assert.equal(saved?.kind, "event");
  assert.equal(saved?.startAt, "2026-07-25T14:00:00+09:00");
  assert.equal(saved?.endAt, "2026-07-25T15:00:00+09:00");
  assert.equal(saved?.metadata.location, "학생회관 401호");
  assert.equal(saved?.metadata.reminderOffsetMinutes, 60);
});

test("submitAdd는 존재하지 않는 날짜를 거절한다(2월 30일)", async () => {
  const container = createCliContainer({ databasePath: ":memory:" });

  const result = await submitAdd(container, { title: "약속", date: "2026-02-30", time: "10:00" }, NOW);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "validation");
});

test("submitAdd는 종료 시각이 시작 시각보다 빠르면 거절한다", async () => {
  const container = createCliContainer({ databasePath: ":memory:" });

  const result = await submitAdd(container, {
    title: "약속",
    date: "2026-07-25",
    time: "14:00",
    endTime: "13:00",
  }, NOW);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "validation");
});

test("runSync(IPC)는 등록된 Source를 동기화하고 수집·생성 건수를 반환한다", async () => {
  const container = createCliContainer({ databasePath: ":memory:" });

  const result = await runSyncIpc(container, NOW);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.data.collected > 0);
  assert.ok(result.data.created > 0);
  assert.deepEqual(Object.keys(result.data).sort(), ["collected", "created"]);
});
