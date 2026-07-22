import assert from "node:assert/strict";
import test from "node:test";

import { computeBackoffDelayMs } from "../apps/cli/src/runtime/jobQueue/backoff.ts";

test("첫 재시도(attempts=1)는 기본 지연(30초)이다", () => {
  assert.equal(computeBackoffDelayMs(1), 30_000);
});

test("실패할 때마다 지연이 두 배로 늘어난다", () => {
  assert.equal(computeBackoffDelayMs(2), 60_000);
  assert.equal(computeBackoffDelayMs(3), 120_000);
  assert.equal(computeBackoffDelayMs(4), 240_000);
});

test("1시간을 넘지 않는다", () => {
  assert.equal(computeBackoffDelayMs(10), 60 * 60_000);
  assert.equal(computeBackoffDelayMs(100), 60 * 60_000);
});

test("attempts가 0 이하여도 음수 지연을 만들지 않는다", () => {
  assert.equal(computeBackoffDelayMs(0), 30_000);
});
