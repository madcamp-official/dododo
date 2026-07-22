import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Renderer 브라우저에서 직접 실행하는 JavaScript 모듈이다.
import { elapsedStudyTime, studyProgressView, studySummaryView } from "../apps/desktop/src/renderer/character/study-session-ui.mjs";

test("공부 세션 경과 시간을 초·분·시간 단위로 표시한다", () => {
  assert.equal(elapsedStudyTime("2026-07-22T01:00:00Z", new Date("2026-07-22T01:03:07Z")).label, "03:07");
  assert.equal(elapsedStudyTime("2026-07-22T01:00:00Z", new Date("2026-07-22T02:05:00Z")).label, "1시간 05분");
  assert.equal(elapsedStudyTime("invalid").label, "시간 확인 중");
});

test("복원된 세션은 사용자에게 복원 상태를 명시한다", () => {
  const view = studyProgressView({ startedAt: "2026-07-22T01:00:00Z", restored: true }, new Date("2026-07-22T01:01:00Z"));
  assert.equal(view.statusText, "이전에 진행하던 세션을 복원했습니다.");
});

test("종료 요약은 시간과 조언 횟수를 읽기 쉬운 문구로 만든다", () => {
  assert.deepEqual(studySummaryView({ summaryText: "수고했어요.", durationMinutes: 75, adviceCount: 2 }), {
    title: "수고했어요.", durationLabel: "1시간 15분", adviceLabel: "도토리 조언 2회",
  });
  assert.equal(studySummaryView({ durationMinutes: 65, adviceCount: 0 }).durationLabel, "1시간 05분");
  assert.equal(studySummaryView({ durationMinutes: 10, adviceCount: 0 }).adviceLabel, "방해 없이 집중했어요");
});
