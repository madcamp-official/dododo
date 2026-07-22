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

test("imageDataBoundary가 아예 없으면(구식 Provider) 안전하게 허용한다(local과 동일 취급)", () => {
  assert.equal(isImageTransmissionAllowed({}), true);
});
