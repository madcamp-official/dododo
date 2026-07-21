import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

import { createMutex } from "../apps/cli/src/runtime/mutex.ts";

test("mutex는 동시에 run()을 호출해도 겹치지 않게 직렬 실행한다", async () => {
  const mutex = createMutex();
  const order: string[] = [];
  let concurrentCount = 0;
  let maxConcurrent = 0;

  async function task(name: string, ms: number) {
    return mutex.run(async () => {
      concurrentCount += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrentCount);
      order.push(`${name}-start`);
      await delay(ms);
      order.push(`${name}-end`);
      concurrentCount -= 1;
    });
  }

  await Promise.all([task("a", 20), task("b", 5), task("c", 10)]);

  assert.equal(maxConcurrent, 1, "동시에 실행 중인 작업이 항상 1개 이하여야 함");
  assert.deepEqual(order, ["a-start", "a-end", "b-start", "b-end", "c-start", "c-end"]);
});

test("mutex는 앞선 작업이 실패해도 다음 작업을 계속 실행한다", async () => {
  const mutex = createMutex();

  const first = mutex.run(async () => {
    throw new Error("첫 작업 실패");
  });
  const second = mutex.run(async () => "두 번째 작업 성공");

  await assert.rejects(first, /첫 작업 실패/);
  assert.equal(await second, "두 번째 작업 성공");
});
