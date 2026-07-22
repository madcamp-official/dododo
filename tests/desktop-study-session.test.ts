import assert from "node:assert/strict";
import test from "node:test";

import { StudySessionManager } from "../apps/desktop/src/main/ipc/studySession.ts";
import { handleStudyEnd, handleStudyStart } from "../apps/desktop/src/main/ipc/handlers.ts";

test("세션은 화면 분석 동의 없이는 시작하지 않는다", () => {
  const result = new StudySessionManager().start(false);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "validation");
});

test("세션은 중복 시작을 막고 종료 시 실제 경과 시간을 요약한다", () => {
  const manager = new StudySessionManager();
  const started = manager.start(true, new Date("2026-07-22T10:00:00+09:00"));
  assert.equal(started.ok, true);
  if (!started.ok) return;

  const duplicate = manager.start(true, new Date("2026-07-22T10:10:00+09:00"));
  assert.equal(duplicate.ok, false);

  const ended = manager.end(started.data.sessionId, new Date("2026-07-22T10:42:30+09:00"));
  assert.equal(ended.ok, true);
  if (!ended.ok) {
    return;
  }
  assert.equal(ended.data.durationMinutes, 42);
  assert.equal(ended.data.adviceCount, 0);
  assert.match(ended.data.summaryText, /42분/);
});

test("study IPC 경계는 payload 형식을 검증한다", async () => {
  const manager = new StudySessionManager();
  const invalidStart = await handleStudyStart(manager, { screenCaptureConsent: "yes" });
  assert.equal(invalidStart.ok, false);
  const invalidEnd = await handleStudyEnd(manager, { sessionId: "" });
  assert.equal(invalidEnd.ok, false);
});
