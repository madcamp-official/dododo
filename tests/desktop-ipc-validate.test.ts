import assert from "node:assert/strict";
import test from "node:test";

import { isNonEmptyString, isRecord } from "../apps/desktop/src/main/ipc/validate.ts";

test("isRecord는 null·배열·원시값을 거절하고 일반 객체만 허용한다", () => {
  assert.equal(isRecord({}), true);
  assert.equal(isRecord({ a: 1 }), true);
  assert.equal(isRecord(null), false);
  assert.equal(isRecord(undefined), false);
  assert.equal(isRecord([]), false);
  assert.equal(isRecord("string"), false);
  assert.equal(isRecord(42), false);
});

test("isNonEmptyString은 빈 문자열·공백·비문자열을 거절한다", () => {
  assert.equal(isNonEmptyString("hello"), true);
  assert.equal(isNonEmptyString(""), false);
  assert.equal(isNonEmptyString("   "), false);
  assert.equal(isNonEmptyString(undefined), false);
  assert.equal(isNonEmptyString(123), false);
  assert.equal(isNonEmptyString(null), false);
});
