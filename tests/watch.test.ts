import assert from "node:assert/strict";
import test from "node:test";

import { runWatch } from "../apps/cli/src/commands/watch.ts";
import { createCliContainer, emptyProfile } from "../apps/cli/src/runtime/container.ts";
import { runWatchLoop } from "../apps/cli/src/runtime/watchLoop.ts";
import { runWatchTick } from "../apps/cli/src/runtime/watchTick.ts";
import type { Notifier, Recommendation } from "../packages/shared/src/index.ts";

// 모킹 프레임워크 대신 실제 객체 하나를 만들어 send() 호출을 기록한다(repo 관례).
class RecordingNotifier implements Notifier {
  readonly sent: Recommendation[] = [];
  async send(recommendation: Recommendation): Promise<void> {
    this.sent.push(recommendation);
  }
}

test("runWatchTick은 첫 실행에서 Source를 동기화하고 알림을 보낸다", async () => {
  const container = createCliContainer();

  const result = await runWatchTick(container, new Date("2026-07-20T10:00:00+09:00"));

  assert.equal(result.syncedSources.length, container.collectors.length);
  for (const synced of result.syncedSources) assert.deepEqual(synced.errors, []);
  assert.ok(result.notified.length > 0);
  assert.deepEqual(result.heldForQuietHours, []);
});

test("runWatchTick은 gate를 통과한 추천을 notifier.send로 전달한다", async () => {
  const container = createCliContainer();
  const notifier = new RecordingNotifier();
  container.notifier = notifier;

  const result = await runWatchTick(container, new Date("2026-07-20T10:00:00+09:00"));

  assert.equal(notifier.sent.length, result.notified.length);
  assert.deepEqual(notifier.sent.map((r) => r.id).sort(), result.notified.map((r) => r.id).sort());
});

test("runWatchTick은 30분 이내 재실행에서 같은 항목을 다시 알리지 않는다", async () => {
  const container = createCliContainer();
  const first = await runWatchTick(container, new Date("2026-07-20T10:00:00+09:00"));
  assert.ok(first.notified.length > 0);

  const second = await runWatchTick(container, new Date("2026-07-20T10:01:00+09:00"));

  assert.deepEqual(second.notified, []);
});

test("runWatchTick은 Quiet Hours 안이면 알림을 보류한다", async () => {
  const container = createCliContainer();
  await container.profileRepository.save({ ...emptyProfile(), quietHours: { start: "00:00", end: "23:59" } });

  const result = await runWatchTick(container, new Date("2026-07-20T10:00:00+09:00"));

  assert.deepEqual(result.notified, []);
  assert.ok(result.heldForQuietHours.length > 0);
  for (const held of result.heldForQuietHours) assert.ok(held.suppressedUntil !== undefined);
});

test("runWatchLoop은 maxIterations:1이면 실제 대기 없이 즉시 끝난다", async () => {
  const container = createCliContainer();
  let sleepCalls = 0;

  const results = await runWatchLoop(container, {
    intervalMs: 999_999_999,
    maxIterations: 1,
    now: () => new Date("2026-07-20T10:00:00+09:00"),
    sleep: async () => {
      sleepCalls += 1;
    },
  });

  assert.equal(results.length, 1);
  assert.equal(sleepCalls, 0);
});

test("runWatchLoop은 마지막 iteration 뒤엔 sleep을 호출하지 않는다", async () => {
  const container = createCliContainer();
  const sleepCalls: number[] = [];

  const results = await runWatchLoop(container, {
    intervalMs: 1234,
    maxIterations: 3,
    now: () => new Date("2026-07-20T10:00:00+09:00"),
    sleep: async (ms) => {
      sleepCalls.push(ms);
    },
  });

  assert.equal(results.length, 3);
  assert.deepEqual(sleepCalls, [1234, 1234]);
});

test("runWatchLoop은 이미 abort된 signal이어도 최소 1회는 실행한 뒤 멈춘다", async () => {
  const container = createCliContainer();
  const controller = new AbortController();
  controller.abort();
  let sleepCalls = 0;

  const results = await runWatchLoop(container, {
    intervalMs: 1000,
    signal: controller.signal,
    now: () => new Date("2026-07-20T10:00:00+09:00"),
    sleep: async () => {
      sleepCalls += 1;
    },
  });

  assert.equal(results.length, 1);
  assert.equal(sleepCalls, 0);
});

test("runWatch는 기본값(1회 실행)으로 즉시 끝난다", async () => {
  const container = createCliContainer();

  const output = await runWatch(container, [], new Date("2026-07-20T10:00:00+09:00"));

  assert.match(output, /Watch 종료: 1회 실행/);
  assert.match(output, /\[tick 1\]/);
});

test("runWatch는 알 수 없는 옵션에 사용법을 보여준다", async () => {
  const container = createCliContainer();
  const output = await runWatch(container, ["--bogus"]);
  assert.match(output, /알 수 없는 옵션입니다: --bogus/);
});

test("runWatch는 잘못된 --interval 값을 거부한다", async () => {
  const container = createCliContainer();
  const output = await runWatch(container, ["--interval", "0"]);
  assert.match(output, /--interval은 0보다 큰 초 단위 숫자여야 합니다/);
});
