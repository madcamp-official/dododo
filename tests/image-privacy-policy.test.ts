import assert from "node:assert/strict";
import test from "node:test";

import { isImageTransmissionAllowed } from "../packages/context-engine/src/llm/imagePrivacyPolicy.ts";

test("provider가 없으면(undefined) 이미지 전송을 허용하지 않는다", () => {
  assert.equal(isImageTransmissionAllowed(undefined), false);
});

test("imageDataBoundary가 remote면 허용하지 않는다", () => {
  assert.equal(isImageTransmissionAllowed({ imageDataBoundary: "remote" }), false);
});

test("imageDataBoundary가 local이면 허용한다", () => {
  assert.equal(isImageTransmissionAllowed({ imageDataBoundary: "local" }), true);
});

// doyeonid 리뷰(PR #99) P1: 하드 방어선이므로 "local"이라고 명시하지 않은 값은
// 전부 차단해야 한다 — 필드를 깜빡한 새 Provider 구현이 조용히 허용되면 안 된다.
test("imageDataBoundary가 없으면(필드 누락) fail-closed로 차단한다", () => {
  assert.equal(isImageTransmissionAllowed({}), false);
});

test("imageDataBoundary가 local/remote가 아닌 다른 값이어도 차단한다", () => {
  assert.equal(isImageTransmissionAllowed({ imageDataBoundary: "unknown" as never }), false);
});
