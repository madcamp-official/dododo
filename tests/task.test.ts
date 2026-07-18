import assert from "node:assert/strict";
import test from "node:test";

import { runTask } from "../apps/cli/src/commands/task.ts";
import { renderToday } from "../apps/cli/src/commands/today.ts";
import { createCliContainer } from "../apps/cli/src/runtime/container.ts";
import { runSync } from "../apps/cli/src/commands/sync.ts";

async function seededContainer() {
  const container = createCliContainer();
  await runSync(container);
  const tasks = await container.repository.listContextItems("task");
  const opportunities = await container.repository.listContextItems("opportunity");
  return { container, taskId: tasks[0]?.id as string, opportunityId: opportunities[0]?.id as string };
}

test("task show는 Task 상세를 표시한다", async () => {
  const { container, taskId } = await seededContainer();

  const output = await runTask(container, ["show", taskId]);

  assert.match(output, /Task 상세/);
  assert.match(output, /제목:/);
  assert.match(output, /상태: new/);
});

test("task show는 존재하지 않는 id에 명확한 오류를 낸다", async () => {
  const { container } = await seededContainer();

  const output = await runTask(container, ["show", "no-such-id"]);

  assert.match(output, /찾을 수 없습니다/);
});

test("task show는 Task가 아닌 id를 거부한다", async () => {
  const { container, opportunityId } = await seededContainer();

  const output = await runTask(container, ["show", opportunityId]);

  assert.match(output, /Task가 아니라/);
});

test("task done은 상태를 done으로 바꾼다", async () => {
  const { container, taskId } = await seededContainer();

  const output = await runTask(container, ["done", taskId]);
  const updated = await container.repository.findContextItem(taskId);

  assert.match(output, /완료 처리했습니다/);
  assert.equal(updated?.status, "done");
});

test("task snooze는 지정 시각까지 today 출력에서 항목을 숨긴다", async () => {
  const { container, taskId } = await seededContainer();
  const future = new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString();

  const output = await runTask(container, ["snooze", taskId, "--until", future]);
  const updated = await container.repository.findContextItem(taskId);
  const today = await renderToday(container);

  assert.match(output, /Snooze했습니다/);
  assert.equal(updated?.metadata.snoozedUntil, future);
  assert.doesNotMatch(today, new RegExp(updated?.title ?? "__none__"));
});

test("task snooze는 --until이 없으면 상태를 바꾸지 않는다", async () => {
  const { container, taskId } = await seededContainer();
  const before = await container.repository.findContextItem(taskId);

  const output = await runTask(container, ["snooze", taskId]);
  const after = await container.repository.findContextItem(taskId);

  assert.match(output, /--until/);
  assert.deepEqual(after, before);
});

test("task snooze는 잘못된 날짜 문자열을 거부하고 상태를 바꾸지 않는다", async () => {
  const { container, taskId } = await seededContainer();
  const before = await container.repository.findContextItem(taskId);

  const output = await runTask(container, ["snooze", taskId, "--until", "다음주 언젠가"]);
  const after = await container.repository.findContextItem(taskId);

  assert.match(output, /올바른 시각이 아닙니다/);
  assert.deepEqual(after, before);
});

test("task는 서브커맨드가 없거나 알 수 없으면 사용법을 보여준다", async () => {
  const { container } = await seededContainer();

  assert.match(await runTask(container, []), /사용법/);
  assert.match(await runTask(container, ["frobnicate", "x"]), /알 수 없는 task 서브커맨드/);
});
