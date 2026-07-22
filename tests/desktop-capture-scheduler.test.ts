import assert from "node:assert/strict";
import test from "node:test";

import { createStudyCaptureScheduler } from "../apps/desktop/src/main/study/captureScheduler.ts";

// 실제 타이머를 기다리지 않도록 setIntervalFn/clearIntervalFn을 가짜로 주입한다 —
// 등록된 콜백을 테스트가 직접 붙잡아 원하는 시점에 호출한다.
function fakeInterval() {
  let registeredHandler: (() => void) | undefined;
  let registeredMs: number | undefined;
  let cleared = false;
  return {
    setIntervalFn: (handler: () => void, ms: number) => {
      registeredHandler = handler;
      registeredMs = ms;
      cleared = false;
      return "fake-handle";
    },
    clearIntervalFn: (handle: unknown) => {
      assert.equal(handle, "fake-handle");
      cleared = true;
    },
    fireTick: () => registeredHandler?.(),
    get registeredMs() { return registeredMs; },
    get isCleared() { return cleared; },
  };
}

test("start()는 pollIntervalMs로 타이머를 등록하고 stop()은 해지한다", () => {
  const timer = fakeInterval();
  const scheduler = createStudyCaptureScheduler({
    getIdleSeconds: () => 0,
    onTrigger: () => {},
    pollIntervalMs: 5000,
    setIntervalFn: timer.setIntervalFn,
    clearIntervalFn: timer.clearIntervalFn,
  });

  scheduler.start();
  assert.equal(timer.registeredMs, 5000);
  assert.equal(timer.isCleared, false);

  scheduler.stop();
  assert.equal(timer.isCleared, true);
});

test("start()를 다시 호출하면 이전 상태(wasIdle/lastCaptureAt)를 초기화한다", () => {
  const timer = fakeInterval();
  let idle = 0;
  const triggers: string[] = [];
  const scheduler = createStudyCaptureScheduler({
    getIdleSeconds: () => idle,
    onTrigger: (reason) => triggers.push(reason),
    setIntervalFn: timer.setIntervalFn,
    clearIntervalFn: timer.clearIntervalFn,
  });

  scheduler.start();
  idle = 90; timer.fireTick();
  idle = 0; timer.fireTick(); // idle→active 전환, 트리거 1회
  assert.deepEqual(triggers, ["idle-to-active"]);

  scheduler.start(); // 세션을 다시 시작하면 상태가 초기화된다
  timer.fireTick(); // 초기 상태(wasIdle:false) 그대로라 지금 idle=0이어도 트리거 아님
  assert.deepEqual(triggers, ["idle-to-active"]);

  idle = 90; timer.fireTick();
  idle = 0; timer.fireTick(); // 재시작 후에도 다시 idle→active 전환은 정상 트리거된다
  assert.deepEqual(triggers, ["idle-to-active", "idle-to-active"]);
});

test("pollOnce는 실제 타이머 없이 즉시 판정한다", () => {
  let idle = 0;
  const triggers: string[] = [];
  const scheduler = createStudyCaptureScheduler({
    getIdleSeconds: () => idle,
    onTrigger: (reason) => triggers.push(reason),
  });

  scheduler.pollOnce();
  idle = 90;
  scheduler.pollOnce();
  idle = 0;
  scheduler.pollOnce();

  assert.deepEqual(triggers, ["idle-to-active"]);
});
