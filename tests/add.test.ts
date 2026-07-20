import assert from "node:assert/strict";
import test from "node:test";
import { Readable, Writable } from "node:stream";

import { runAdd } from "../apps/cli/src/commands/add.ts";
import { createCliContainer } from "../apps/cli/src/runtime/container.ts";

function discardOutput(): Writable {
  return new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
}

function scriptedInput(answer: string): Readable {
  return Readable.from((async function* () {
    await new Promise((resolve) => setImmediate(resolve));
    yield `${answer}\n`;
  })());
}

const NOW = new Date("2026-07-20T10:00:00+09:00");

test("add는 내용이 비어있으면 사용법을 보여준다", async () => {
  const container = createCliContainer();
  const output = await runAdd(container, [], NOW);
  assert.match(output, /사용법: dododo add/);
});

test("add는 일정 의도를 못 알아들으면 안내한다", async () => {
  const container = createCliContainer();
  const output = await runAdd(container, ["아무", "말이나", "던짐"], NOW);
  assert.match(output, /알아듣지 못했습니다/);
});

test("add는 y로 확인하면 Event를 저장한다", async () => {
  const container = createCliContainer();
  const io = { input: scriptedInput("y"), output: discardOutput() };

  const output = await runAdd(
    container,
    ["이번주", "금요일", "19시에", "민수랑", "저녁", "약속", "있어"],
    NOW,
    io,
  );

  assert.match(output, /일정을 저장했습니다/);
  const items = await container.repository.listContextItems("event");
  assert.equal(items.length, 1);
  assert.equal(items[0]?.status, "confirmed");
});

test("add는 확인 답이 y/edit이 아니면 취소한다", async () => {
  const container = createCliContainer();
  const io = { input: scriptedInput("n"), output: discardOutput() };

  const output = await runAdd(
    container,
    ["이번주", "금요일", "19시에", "민수랑", "저녁", "약속", "있어"],
    NOW,
    io,
  );

  assert.match(output, /취소했습니다/);
  assert.deepEqual(await container.repository.listContextItems("event"), []);
});

test("add는 edit이면 다시 입력하라고 안내하고 저장하지 않는다", async () => {
  const container = createCliContainer();
  const io = { input: scriptedInput("edit"), output: discardOutput() };

  const output = await runAdd(
    container,
    ["이번주", "금요일", "19시에", "민수랑", "저녁", "약속", "있어"],
    NOW,
    io,
  );

  assert.match(output, /다시 `dododo add/);
  assert.deepEqual(await container.repository.listContextItems("event"), []);
});
