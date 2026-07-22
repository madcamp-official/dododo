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

// doyeonid 리뷰(PR #92) P2: now()를 한 poll 안에서 두 번 읽으면(판정용 한 번, onTrigger
// 전달용 한 번) 전진하는 clock에서 최소 간격 판정과 실제 보고 시각이 어긋난다 —
// now()가 poll당 정확히 한 번만 불리는지, 그리고 그 값이 onTrigger에 그대로 전달되는지
// 확인한다.
test("pollOnce는 판정과 onTrigger에 같은 시각을 쓴다(now()는 poll당 한 번만 호출)", () => {
  let callCount = 0;
  let current = new Date("2026-07-22T00:00:00Z");
  const now = () => {
    callCount += 1;
    return current;
  };
  let idle = 0;
  const triggeredAt: Date[] = [];
  const scheduler = createStudyCaptureScheduler({
    getIdleSeconds: () => idle,
    now,
    onTrigger: (_reason, at) => triggeredAt.push(at),
  });

  scheduler.pollOnce();
  assert.equal(callCount, 1);

  idle = 90;
  scheduler.pollOnce();
  assert.equal(callCount, 2);

  current = new Date(current.getTime() + 5000); // clock이 전진한다
  idle = 0;
  scheduler.pollOnce(); // idle→active 트리거
  assert.equal(callCount, 3);
  assert.equal(triggeredAt.length, 1);
  assert.equal(triggeredAt[0]?.getTime(), current.getTime());
});

test("같이 공부하기 중 10분 이상 유휴 상태면 집중 확인을 한 번만 알린다", () => {
  let idle = 0;
  const longIdleEvents: Date[] = [];
  const now = new Date("2026-07-23T00:00:00Z");
  const scheduler = createStudyCaptureScheduler({
    getIdleSeconds: () => idle,
    now: () => now,
    onTrigger: () => {},
    onLongIdle: (at) => longIdleEvents.push(at),
  });

  scheduler.start();
  idle = 599; scheduler.pollOnce();
  idle = 600; scheduler.pollOnce();
  idle = 900; scheduler.pollOnce();
  assert.deepEqual(longIdleEvents, [now]);

  idle = 0; scheduler.pollOnce();
  idle = 600; scheduler.pollOnce();
  assert.deepEqual(longIdleEvents, [now, now]);
  scheduler.stop();
});
