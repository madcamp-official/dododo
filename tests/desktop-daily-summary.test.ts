import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Renderer 브라우저에서 직접 실행하는 JavaScript 모듈이다.
import { buildDailySummary, dailySummaryRetryDelayMs, isWithinQuietHours, localDateKey, shouldShowDailySummary } from "../apps/desktop/src/renderer/character/daily-summary.mjs";
// @ts-expect-error Renderer 브라우저에서 직접 실행하는 JavaScript 모듈이다.
import { normalizeNotification, notificationKindLabel, notificationMode } from "../apps/desktop/src/renderer/character/notification-state.mjs";

const profile = { quietHours: { start: "22:00", end: "07:00" } };

test("날짜 키는 시스템 TZ가 아니라 Asia/Seoul 날짜를 사용한다", () => {
  assert.equal(localDateKey(new Date("2026-07-20T15:30:00.000Z")), "2026-07-21");
});

test("자정을 지나는 Quiet Hours를 정확히 판정한다", () => {
  assert.equal(isWithinQuietHours(profile, new Date("2026-07-21T14:00:00.000Z")), true);
  assert.equal(isWithinQuietHours(profile, new Date("2026-07-20T22:30:00.000Z")), false);
  assert.equal(isWithinQuietHours({}, new Date("2026-07-21T14:00:00.000Z")), false);
});

test("같은 날짜 또는 Quiet Hours에는 일일 요약을 표시하지 않는다", () => {
  const daytime = new Date("2026-07-21T03:00:00.000Z");
  assert.deepEqual(shouldShowDailySummary("2026-07-21", {}, daytime), { today: "2026-07-21", show: false });
  assert.equal(shouldShowDailySummary(undefined, profile, new Date("2026-07-21T14:00:00.000Z")).show, false);
  assert.equal(shouldShowDailySummary(undefined, profile, daytime).show, true);
});

test("Quiet Hours 종료까지 남은 시간만큼 재시도를 예약한다", () => {
  assert.equal(
    dailySummaryRetryDelayMs(profile, new Date("2026-07-21T14:30:15.250Z")),
    7 * 60 * 60 * 1_000 + 29 * 60 * 1_000 + 44_750,
  );
  assert.equal(
    dailySummaryRetryDelayMs(profile, new Date("2026-07-21T21:30:15.250Z")),
    29 * 60 * 1_000 + 44_750,
  );
  assert.equal(dailySummaryRetryDelayMs(profile, new Date("2026-07-21T03:00:00.000Z")), undefined);
});

test("빈 오늘 목록은 부담 없는 안내로 요약한다", () => {
  assert.equal(buildDailySummary([]), "오늘은 등록된 일정이나 할 일이 없어요.");
});

test("오늘 목록은 상위 두 제목과 남은 개수를 요약한다", () => {
  const entries = ["과제 제출", "팀 회의", "저녁 약속"].map((title) => ({ item: { title } }));
  assert.equal(buildDailySummary(entries), "오늘 확인할 일이 3개 있어요. “과제 제출”, “팀 회의” 외 1개를 살펴볼까요?");
});

test("일일 요약 알림은 Today 대상으로 정규화된다", () => {
  const createdAt = "2026-07-21T03:00:00.000Z";
  assert.equal(notificationMode("daily-summary"), "immediate");
  assert.equal(notificationKindLabel("daily-summary"), "오늘 요약");
  assert.deepEqual(normalizeNotification({ kind: "daily-summary", message: "오늘 요약", targetView: "today", createdAt }), {
    kind: "daily-summary", message: "오늘 요약", targetView: "today", createdAt,
  });
  assert.equal(normalizeNotification({ kind: "daily-summary", message: "요약", targetView: "calendar", createdAt }), undefined);
});
