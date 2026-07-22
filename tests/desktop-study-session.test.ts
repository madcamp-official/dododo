import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { handleStudyEnd, handleStudyGet, handleStudyStart } from "../apps/desktop/src/main/ipc/handlers.ts";
import { StudySessionManager } from "../apps/desktop/src/main/ipc/studySession.ts";

async function statePath(t: test.TestContext): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "dododo-study-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return join(directory, "active-study-session.json");
}

test("세션은 화면 분석 동의 없이는 시작하지 않는다", async (t) => {
  const result = await new StudySessionManager(await statePath(t)).start(false);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "validation");
});

test("세션은 프로세스가 다시 만들어져도 복원되고 종료 시 저장 상태를 제거한다", async (t) => {
  const path = await statePath(t);
  const firstProcess = new StudySessionManager(path);
  const started = await firstProcess.start(true, new Date("2026-07-22T10:00:00+09:00"));
  assert.equal(started.ok, true);
  if (!started.ok) return;

  const stored = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  assert.deepEqual(Object.keys(stored).sort(), ["adviceCount", "sessionId", "startedAt"]);

  const restartedProcess = new StudySessionManager(path);
  const restored = await restartedProcess.getActive();
  assert.deepEqual(restored, { ok: true, data: started.data });

  const duplicate = await restartedProcess.start(true, new Date("2026-07-22T10:10:00+09:00"));
  assert.equal(duplicate.ok, false);

  const ended = await restartedProcess.end(started.data.sessionId, new Date("2026-07-22T10:42:30+09:00"));
  assert.equal(ended.ok, true);
  if (!ended.ok) return;
  assert.equal(ended.data.durationMinutes, 42);
  assert.equal(ended.data.adviceCount, 0);
  assert.deepEqual(await restartedProcess.getActive(), { ok: true, data: undefined });
});

test("recordAdvice는 실제로 발행한 조언 수만큼 adviceCount를 늘리고 종료 응답에 그대로 반영된다", async (t) => {
  const path = await statePath(t);
  const manager = new StudySessionManager(path);
  const started = await manager.start(true, new Date("2026-07-22T10:00:00+09:00"));
  assert.equal(started.ok, true);
  if (!started.ok) return;

  assert.equal((await manager.recordAdvice(started.data.sessionId)).ok, true);
  assert.equal((await manager.recordAdvice(started.data.sessionId)).ok, true);

  const ended = await manager.end(started.data.sessionId, new Date("2026-07-22T10:30:00+09:00"));
  assert.equal(ended.ok, true);
  if (!ended.ok) return;
  assert.equal(ended.data.adviceCount, 2);
});

test("recordAdvice는 세션이 이미 끝났거나 다른 세션이면 not-found로 실패한다(늦게 도착한 조언 격리)", async (t) => {
  const path = await statePath(t);
  const manager = new StudySessionManager(path);

  const noSession = await manager.recordAdvice("session-x");
  assert.equal(noSession.ok, false);
  if (!noSession.ok) assert.equal(noSession.error.code, "not-found");

  const started = await manager.start(true, new Date("2026-07-22T10:00:00+09:00"));
  assert.equal(started.ok, true);
  if (!started.ok) return;

  const wrongSession = await manager.recordAdvice("다른-세션-id");
  assert.equal(wrongSession.ok, false);
  if (!wrongSession.ok) assert.equal(wrongSession.error.code, "not-found");
});

// doyeonid 리뷰(PR #96) P1: recordAdvice와 end가 직렬화되지 않으면, recordAdvice가
// 세션을 읽은 뒤 end가 먼저 끝나 파일을 지워도 recordAdvice가 그 stale한 값을 다시
// 써서 이미 끝난 세션을 되살릴 수 있었다. recordAdvice(먼저 호출)와 end(나중 호출)를
// Promise.all로 겹쳐 실행해도 mutex가 호출 순서대로 직렬화해 늘어난 카운트가
// end 응답에 반영되고, end 이후 getActive()는 항상 undefined임을 확인한다.
test("겹쳐 실행한 recordAdvice와 end는 세션을 되살리지 않고 카운트도 잃지 않는다", async (t) => {
  const path = await statePath(t);
  const manager = new StudySessionManager(path);
  const started = await manager.start(true, new Date("2026-07-22T10:00:00+09:00"));
  assert.equal(started.ok, true);
  if (!started.ok) return;

  const [adviceResult, endResult] = await Promise.all([
    manager.recordAdvice(started.data.sessionId),
    manager.end(started.data.sessionId, new Date("2026-07-22T10:05:00+09:00")),
  ]);

  assert.equal(adviceResult.ok, true);
  assert.equal(endResult.ok, true);
  if (!endResult.ok) return;
  // recordAdvice가 mutex 큐에 먼저 들어갔으므로(호출 순서) end보다 먼저 실행되고,
  // end는 그 증가분을 반영한 상태를 본다.
  assert.equal(endResult.data.adviceCount, 1);
  assert.deepEqual(await manager.getActive(), { ok: true, data: undefined });
});

test("겹쳐 실행한 recordAdvice 여러 건은 서로의 증가분을 잃지 않는다", async (t) => {
  const path = await statePath(t);
  const manager = new StudySessionManager(path);
  const started = await manager.start(true, new Date("2026-07-22T10:00:00+09:00"));
  assert.equal(started.ok, true);
  if (!started.ok) return;

  const results = await Promise.all([
    manager.recordAdvice(started.data.sessionId),
    manager.recordAdvice(started.data.sessionId),
    manager.recordAdvice(started.data.sessionId),
  ]);
  assert.ok(results.every((result) => result.ok));

  const ended = await manager.end(started.data.sessionId, new Date("2026-07-22T10:10:00+09:00"));
  assert.equal(ended.ok, true);
  if (!ended.ok) return;
  assert.equal(ended.data.adviceCount, 3);
});

test("손상된 세션 파일은 앱 시작을 막지 않고 활성 세션 없음으로 처리한다", async (t) => {
  const path = await statePath(t);
  await writeFile(path, "{broken", "utf8");
  const result = await new StudySessionManager(path).getActive();
  assert.deepEqual(result, { ok: true, data: undefined });
});

test("study IPC 경계는 payload 형식을 검증한다", async (t) => {
  const manager = new StudySessionManager(await statePath(t));
  const invalidStart = await handleStudyStart(manager, { screenCaptureConsent: "yes" });
  assert.equal(invalidStart.ok, false);
  const invalidEnd = await handleStudyEnd(manager, { sessionId: "" });
  assert.equal(invalidEnd.ok, false);
});

test("세션 상태 파일 접근 실패도 Result 오류로 변환한다", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "dododo-study-error-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const result = await handleStudyGet(new StudySessionManager(root));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "unknown");
});
