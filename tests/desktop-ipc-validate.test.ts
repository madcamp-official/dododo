import assert from "node:assert/strict";
import test from "node:test";

import {
  isNonEmptyString,
  isRecord,
  isUserProfileShape,
  isValidOffsetMinutes,
} from "../apps/desktop/src/main/ipc/validate.ts";

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

test("isValidOffsetMinutes는 0 이상의 정수만 허용한다", () => {
  assert.equal(isValidOffsetMinutes(0), true);
  assert.equal(isValidOffsetMinutes(30), true);
  assert.equal(isValidOffsetMinutes(1440), true);
  assert.equal(isValidOffsetMinutes(-1), false);
  assert.equal(isValidOffsetMinutes(1.5), false);
  assert.equal(isValidOffsetMinutes(Number.NaN), false);
  assert.equal(isValidOffsetMinutes(Number.POSITIVE_INFINITY), false);
  assert.equal(isValidOffsetMinutes("60"), false);
  assert.equal(isValidOffsetMinutes(undefined), false);
});

const validProfile = {
  school: "테스트대", major: "컴퓨터공학", year: "3",
  interests: [], activityTypes: [], preferredLocations: [], explicitConstraints: [],
};

test("isUserProfileShape는 필수 문자열·배열 필드를 모두 갖춘 값만 허용한다", () => {
  assert.equal(isUserProfileShape(validProfile), true);
  assert.equal(isUserProfileShape({ ...validProfile, quietHours: { start: "22:00", end: "07:00" } }), true);
  assert.equal(isUserProfileShape(null), false);
  assert.equal(isUserProfileShape([]), false);
  assert.equal(isUserProfileShape({ ...validProfile, school: 1 }), false);
  assert.equal(isUserProfileShape({ ...validProfile, interests: "AI" }), false);
  assert.equal(isUserProfileShape({ ...validProfile, quietHours: { start: "22:00" } }), false);
  const { major: _major, ...missingMajor } = validProfile;
  assert.equal(isUserProfileShape(missingMajor), false);
});
