import assert from "node:assert/strict";
import test from "node:test";

import type { Recommendation } from "../packages/shared/src/index.ts";
import { emptyProfile } from "../apps/cli/src/runtime/container.ts";
import {
  gateNotification,
  isValidClockTime,
  isWithinQuietHours,
  nextQuietHoursEnd,
} from "../packages/scheduler/src/index.ts";

function profileWithQuietHours(start: string, end: string) {
  return { ...emptyProfile(), quietHours: { start, end } };
}

function sampleRecommendation(): Recommendation {
  return {
    id: "rec-1",
    contextItemId: "task-1",
    action: "과제를 확인하세요",
    reason: "마감이 가까움",
    score: 42,
    evidenceIds: [],
    createdAt: "2026-07-20T00:00:00+09:00",
  };
}

test("당일 구간(09:00-18:00) 경계값을 정확히 판정한다", () => {
  const profile = profileWithQuietHours("09:00", "18:00");

  assert.equal(isWithinQuietHours(profile, new Date("2026-07-20T08:59:00+09:00")), false);
  assert.equal(isWithinQuietHours(profile, new Date("2026-07-20T09:00:00+09:00")), true);
  assert.equal(isWithinQuietHours(profile, new Date("2026-07-20T17:59:00+09:00")), true);
  assert.equal(isWithinQuietHours(profile, new Date("2026-07-20T18:00:00+09:00")), false);
});

test("자정을 넘는 구간(22:00-07:00)을 정확히 판정한다", () => {
  const profile = profileWithQuietHours("22:00", "07:00");

  assert.equal(isWithinQuietHours(profile, new Date("2026-07-20T21:59:00+09:00")), false);
  assert.equal(isWithinQuietHours(profile, new Date("2026-07-20T22:00:00+09:00")), true);
  assert.equal(isWithinQuietHours(profile, new Date("2026-07-20T23:30:00+09:00")), true);
  assert.equal(isWithinQuietHours(profile, new Date("2026-07-21T00:30:00+09:00")), true);
  assert.equal(isWithinQuietHours(profile, new Date("2026-07-21T06:59:00+09:00")), true);
  assert.equal(isWithinQuietHours(profile, new Date("2026-07-21T07:00:00+09:00")), false);
});

test("quietHours가 없으면 항상 false다", () => {
  assert.equal(isWithinQuietHours(emptyProfile(), new Date("2026-07-20T23:00:00+09:00")), false);
});

test("quietHours 형식이 잘못되면 false로 처리한다(fail open)", () => {
  const malformed = { ...emptyProfile(), quietHours: { start: "25:00", end: "18:00" } };
  assert.equal(isWithinQuietHours(malformed, new Date("2026-07-20T10:00:00+09:00")), false);

  const zeroLength = profileWithQuietHours("09:00", "09:00");
  assert.equal(isWithinQuietHours(zeroLength, new Date("2026-07-20T09:00:00+09:00")), false);
});

test("nextQuietHoursEnd는 당일 구간의 종료 시각을 반환한다", () => {
  const profile = profileWithQuietHours("09:00", "18:00");
  const end = nextQuietHoursEnd(profile, new Date("2026-07-20T10:00:00+09:00"));
  assert.equal(end.toISOString(), new Date("2026-07-20T18:00:00+09:00").toISOString());
});

test("nextQuietHoursEnd는 자정 넘는 구간에서 자정 이전이면 다음날 종료 시각을 반환한다", () => {
  const profile = profileWithQuietHours("22:00", "07:00");
  const end = nextQuietHoursEnd(profile, new Date("2026-07-20T23:00:00+09:00"));
  assert.equal(end.toISOString(), new Date("2026-07-21T07:00:00+09:00").toISOString());
});

test("nextQuietHoursEnd는 자정 넘는 구간에서 자정 이후면 당일 종료 시각을 반환한다", () => {
  const profile = profileWithQuietHours("22:00", "07:00");
  const end = nextQuietHoursEnd(profile, new Date("2026-07-21T03:00:00+09:00"));
  assert.equal(end.toISOString(), new Date("2026-07-21T07:00:00+09:00").toISOString());
});

test("nextQuietHoursEnd는 quietHours가 없으면 예외를 던진다", () => {
  assert.throws(() => nextQuietHoursEnd(emptyProfile(), new Date()));
});

test("gateNotification은 Quiet Hours 안이면 보류하고 suppressedUntil을 채운다", () => {
  const profile = profileWithQuietHours("22:00", "07:00");
  const now = new Date("2026-07-20T23:00:00+09:00");

  const result = gateNotification(sampleRecommendation(), profile, now);

  assert.equal(result.send, false);
  assert.equal(result.recommendation.suppressedUntil, new Date("2026-07-21T07:00:00+09:00").toISOString());
});

test("gateNotification은 Quiet Hours 밖이면 그대로 통과시킨다", () => {
  const profile = profileWithQuietHours("22:00", "07:00");
  const now = new Date("2026-07-20T10:00:00+09:00");

  const result = gateNotification(sampleRecommendation(), profile, now);

  assert.equal(result.send, true);
  assert.equal(result.recommendation.suppressedUntil, undefined);
});

test("gateNotification은 quietHours 미설정 profile에서 항상 통과시킨다", () => {
  const result = gateNotification(sampleRecommendation(), emptyProfile(), new Date("2026-07-20T23:00:00+09:00"));
  assert.equal(result.send, true);
});

test("isValidClockTime은 HH:mm 형식만 허용한다", () => {
  assert.equal(isValidClockTime("22:00"), true);
  assert.equal(isValidClockTime("00:00"), true);
  assert.equal(isValidClockTime("23:59"), true);
  assert.equal(isValidClockTime("25:99"), false);
  assert.equal(isValidClockTime("9:00"), false);
  assert.equal(isValidClockTime("abc"), false);
  assert.equal(isValidClockTime(""), false);
});
