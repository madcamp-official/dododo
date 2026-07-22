import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Renderer 브라우저에서 직접 실행하는 JavaScript 모듈이다.
import { buildWeeklyCalendar, groupScheduledItems } from "../apps/desktop/src/renderer/character/schedule-management.mjs";

test("이번 주 항목을 Asia/Seoul 날짜별로 입력 순서대로 묶는다", () => {
  const entries = [
    { item: { id: "a" }, at: "2026-07-20T15:30:00.000Z" },
    { item: { id: "b" }, at: "2026-07-21T01:00:00.000Z" },
    { item: { id: "c" }, at: "2026-07-21T16:00:00.000Z" },
  ];
  const groups = groupScheduledItems(entries);

  assert.equal(groups.length, 2);
  assert.equal(groups[0].key, "2026-07-21");
  assert.deepEqual(groups[0].entries.map((entry: { item: { id: string } }) => entry.item.id), ["a", "b"]);
  assert.equal(groups[1].key, "2026-07-22");
  assert.deepEqual(groups[1].entries.map((entry: { item: { id: string } }) => entry.item.id), ["c"]);
});

test("calendar:get 계약과 같이 날짜가 잘못된 항목은 표시 대상에서 제외한다", () => {
  const entries = [
    { item: { id: "valid" }, at: "2026-07-21T01:00:00.000Z" },
    { item: { id: "invalid" }, at: "not-a-date" },
  ];
  const groups = groupScheduledItems(entries);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].entries.map((entry: { item: { id: string } }) => entry.item.id), ["valid"]);
});

test("빈 일정은 빈 그룹 배열을 반환한다", () => {
  assert.deepEqual(groupScheduledItems([]), []);
});

test("주간 캘린더는 날짜와 시각순으로 정렬하고 서울 시각 라벨을 만든다", () => {
  const calendar = buildWeeklyCalendar([
    { item: { id: "late" }, at: "2026-07-21T07:30:00.000Z" },
    { item: { id: "next-day" }, at: "2026-07-21T16:00:00.000Z" },
    { item: { id: "early" }, at: "2026-07-20T23:00:00.000Z" },
  ]);

  assert.deepEqual(calendar.map((day: { key: string }) => day.key), ["2026-07-21", "2026-07-22"]);
  assert.deepEqual(calendar[0].entries.map((entry: { item: { id: string } }) => entry.item.id), ["early", "late"]);
  assert.deepEqual(calendar[0].entries.map((entry: { timeLabel: string }) => entry.timeLabel), ["08:00", "16:30"]);
});

test("주간 캘린더는 잘못된 시각을 제외한다", () => {
  const calendar = buildWeeklyCalendar([
    { item: { id: "invalid" }, at: "not-a-date" },
    { item: { id: "valid" }, at: "2026-07-21T00:00:00.000Z" },
  ]);
  assert.equal(calendar.length, 1);
  assert.equal(calendar[0].entries[0].item.id, "valid");
});
