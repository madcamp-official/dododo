import assert from "node:assert/strict";
import test from "node:test";

import {
  decideCaptureTrigger,
  initialCaptureTriggerState,
} from "../apps/desktop/src/main/study/captureTrigger.ts";

const idleThresholdSeconds = 60;
const minIntervalMs = 3 * 60_000;

test("계속 활성 상태면 트리거하지 않는다", () => {
  const decision = decideCaptureTrigger(initialCaptureTriggerState(), {
    now: new Date("2026-07-22T00:00:00Z"),
    idleSeconds: 0,
    idleThresholdSeconds,
    minIntervalMs,
  });
  assert.equal(decision.trigger, false);
  assert.equal(decision.reason, undefined);
  assert.equal(decision.nextState.wasIdle, false);
});

test("Active에서 Idle로 들어가는 순간은 트리거하지 않는다", () => {
  const decision = decideCaptureTrigger(initialCaptureTriggerState(), {
    now: new Date("2026-07-22T00:00:00Z"),
    idleSeconds: 90,
    idleThresholdSeconds,
    minIntervalMs,
  });
  assert.equal(decision.trigger, false);
  assert.equal(decision.nextState.wasIdle, true);
});

test("Idle 상태가 계속 유지되는 동안은 매 tick 다시 트리거하지 않는다", () => {
  let state = initialCaptureTriggerState();
  state = decideCaptureTrigger(state, {
    now: new Date("2026-07-22T00:00:00Z"), idleSeconds: 90, idleThresholdSeconds, minIntervalMs,
  }).nextState;
  const decision = decideCaptureTrigger(state, {
    now: new Date("2026-07-22T00:01:00Z"), idleSeconds: 150, idleThresholdSeconds, minIntervalMs,
  });
  assert.equal(decision.trigger, false);
  assert.equal(decision.nextState.wasIdle, true);
});

test("Idle에서 Active로 돌아오는 순간 트리거하고 lastCaptureAt을 기록한다", () => {
  let state = initialCaptureTriggerState();
  state = decideCaptureTrigger(state, {
    now: new Date("2026-07-22T00:00:00Z"), idleSeconds: 90, idleThresholdSeconds, minIntervalMs,
  }).nextState;
  const now = new Date("2026-07-22T00:02:00Z");
  const decision = decideCaptureTrigger(state, { now, idleSeconds: 0, idleThresholdSeconds, minIntervalMs });
  assert.equal(decision.trigger, true);
  assert.equal(decision.reason, "idle-to-active");
  assert.equal(decision.nextState.wasIdle, false);
  assert.equal(decision.nextState.lastCaptureAt?.getTime(), now.getTime());
});

test("idleSeconds가 임계값과 정확히 같으면 Idle로 본다", () => {
  const decision = decideCaptureTrigger(initialCaptureTriggerState(), {
    now: new Date("2026-07-22T00:00:00Z"),
    idleSeconds: idleThresholdSeconds,
    idleThresholdSeconds,
    minIntervalMs,
  });
  assert.equal(decision.nextState.wasIdle, true);
});

test("직전 캡처로부터 minIntervalMs 안에 다시 Idle→Active가 와도 트리거하지 않는다", () => {
  let state = initialCaptureTriggerState();
  state = decideCaptureTrigger(state, {
    now: new Date("2026-07-22T00:00:00Z"), idleSeconds: 90, idleThresholdSeconds, minIntervalMs,
  }).nextState;
  const firstTrigger = decideCaptureTrigger(state, {
    now: new Date("2026-07-22T00:01:00Z"), idleSeconds: 0, idleThresholdSeconds, minIntervalMs,
  });
  assert.equal(firstTrigger.trigger, true);
  state = firstTrigger.nextState;

  state = decideCaptureTrigger(state, {
    now: new Date("2026-07-22T00:01:30Z"), idleSeconds: 90, idleThresholdSeconds, minIntervalMs,
  }).nextState;
  const secondAttempt = decideCaptureTrigger(state, {
    now: new Date("2026-07-22T00:02:00Z"), idleSeconds: 0, idleThresholdSeconds, minIntervalMs,
  });
  assert.equal(secondAttempt.trigger, false);
  // 트리거하지 않았으므로 lastCaptureAt은 이전 값 그대로 보존된다.
  assert.equal(secondAttempt.nextState.lastCaptureAt?.toISOString(), "2026-07-22T00:01:00.000Z");
});

test("minIntervalMs가 지난 뒤 Idle→Active가 다시 오면 트리거한다", () => {
  let state = initialCaptureTriggerState();
  state = decideCaptureTrigger(state, {
    now: new Date("2026-07-22T00:00:00Z"), idleSeconds: 90, idleThresholdSeconds, minIntervalMs,
  }).nextState;
  state = decideCaptureTrigger(state, {
    now: new Date("2026-07-22T00:01:00Z"), idleSeconds: 0, idleThresholdSeconds, minIntervalMs,
  }).nextState;

  state = decideCaptureTrigger(state, {
    now: new Date("2026-07-22T00:03:00Z"), idleSeconds: 90, idleThresholdSeconds, minIntervalMs,
  }).nextState;
  const decision = decideCaptureTrigger(state, {
    now: new Date("2026-07-22T00:04:01Z"), idleSeconds: 0, idleThresholdSeconds, minIntervalMs,
  });
  assert.equal(decision.trigger, true);
});
