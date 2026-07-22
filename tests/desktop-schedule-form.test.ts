import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Renderer는 브라우저에서 직접 실행하는 JavaScript 모듈이다.
import { parseReminderOffset, scheduleItemToForm } from "../apps/desktop/src/renderer/character/schedule-form.mjs";

test("Task를 Asia/Seoul 기준 날짜·마감 폼으로 변환한다", () => {
  assert.deepEqual(scheduleItemToForm({
    kind: "task",
    title: "운영체제 과제",
    deadline: "2026-07-21T18:30:00.000Z",
    metadata: { location: "N1", reminderOffsetMinutes: 60 },
  }), {
    title: "운영체제 과제",
    date: "2026-07-22",
    time: "03:30",
    endTime: "",
    location: "N1",
    reminderOffsetMinutes: 60,
  });
});

test("Event는 시작·종료 시각을 폼으로 변환한다", () => {
  const form = scheduleItemToForm({
    kind: "event",
    title: "팀 회의",
    startAt: "2026-07-22T06:00:00.000Z",
    endAt: "2026-07-22T07:30:00.000Z",
    metadata: {},
  });

  assert.equal(form.date, "2026-07-22");
  assert.equal(form.time, "15:00");
  assert.equal(form.endTime, "16:30");
  assert.equal(form.location, "");
  assert.equal(form.reminderOffsetMinutes, undefined);
});

test("잘못된 일정 시각은 비어 있는 폼 값으로 안전하게 변환한다", () => {
  const form = scheduleItemToForm({ kind: "task", title: "시간 미정", deadline: "invalid", metadata: {} });
  assert.equal(form.date, "");
  assert.equal(form.time, "");
});

test("리마인더 오프셋은 1 이상의 안전한 정수만 허용한다", () => {
  assert.equal(parseReminderOffset("60"), 60);
  for (const value of ["", "0", "-1", "1.5", "abc", "9007199254740992"]) {
    assert.equal(parseReminderOffset(value), undefined);
  }
});
