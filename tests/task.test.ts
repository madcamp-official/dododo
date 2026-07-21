import assert from "node:assert/strict";
import test from "node:test";

import { runTask } from "../apps/cli/src/commands/task.ts";
import { renderToday } from "../apps/cli/src/commands/today.ts";
import { createCliContainer } from "../apps/cli/src/runtime/container.ts";
import { runSync } from "../apps/cli/src/commands/sync.ts";

async function seededContainer() {
  const container = createCliContainer({ databasePath: ":memory:" });
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

test("task show는 유일하게 일치하는 ID 접두어만으로도 항목을 찾는다", async () => {
  // today/inbox 출력에서 ID 전체를 옮겨 적기보다 앞부분만 잘라 쓰는 게 자연스럽다
  // (실제 사용 중 발견된 문제 — today가 ID를 아예 안 보여줘서 항목을 못 찾던 것과
  // 짝을 이루는 개선).
  const { container, taskId } = await seededContainer();
  const prefix = taskId.slice(0, Math.ceil(taskId.length / 2));

  const output = await runTask(container, ["show", prefix]);

  assert.match(output, /Task 상세/);
  assert.match(output, new RegExp(`ID: ${taskId}`));
});

test("task show는 접두어가 여러 항목과 일치하면 후보를 보여주고 아무것도 확정하지 않는다", async () => {
  const { container } = await seededContainer();
  await container.repository.saveContextItems([
    {
      id: "ctx-ambiguous-alpha",
      kind: "task",
      title: "알파 항목",
      status: "todo",
      requirements: [],
      tags: [],
      priority: 0,
      confidence: 1,
      evidenceIds: [],
      metadata: {},
      createdAt: "2026-07-20T00:00:00+09:00",
      updatedAt: "2026-07-20T00:00:00+09:00",
    },
    {
      id: "ctx-ambiguous-beta",
      kind: "task",
      title: "베타 항목",
      status: "todo",
      requirements: [],
      tags: [],
      priority: 0,
      confidence: 1,
      evidenceIds: [],
      metadata: {},
      createdAt: "2026-07-20T00:00:00+09:00",
      updatedAt: "2026-07-20T00:00:00+09:00",
    },
  ]);

  const output = await runTask(container, ["show", "ctx-ambiguous"]);

  assert.match(output, /2개입니다/);
  assert.match(output, /ctx-ambiguous-alpha/);
  assert.match(output, /ctx-ambiguous-beta/);
});

test("task show는 너무 짧은 입력은 접두어 검색을 시도하지 않고 못 찾음으로 처리한다", async () => {
  const { container } = await seededContainer();

  const output = await runTask(container, ["show", "c"]);

  assert.match(output, /찾을 수 없습니다/);
  assert.doesNotMatch(output, /여러 개입니다/);
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

test("renderToday는 항목마다 ID를 표시해 task/evidence로 다시 조회할 수 있게 한다", async () => {
  // 실제 사용 중 발견된 버그: today가 번호(1. 2. 3.)만 보여주고 ID를 전혀 안 보여줘서
  // "task show 1"처럼 화면 번호를 ID로 착각해 입력하면 항상 실패했다.
  const { container, taskId } = await seededContainer();

  const output = await renderToday(container);

  assert.match(output, new RegExp(`ID: ${taskId}`));
});

test("task는 서브커맨드가 없거나 알 수 없으면 사용법을 보여준다", async () => {
  const { container } = await seededContainer();

  assert.match(await runTask(container, []), /사용법/);
  assert.match(await runTask(container, ["frobnicate", "x"]), /알 수 없는 task 서브커맨드/);
});
