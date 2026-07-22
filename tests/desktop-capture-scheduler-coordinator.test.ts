import assert from "node:assert/strict";
import test from "node:test";

import { createCaptureSchedulerCoordinator } from "../apps/desktop/src/main/study/captureSchedulerCoordinator.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

test("applyKnownState는 재확인 없이 즉시 start/stop을 호출한다", () => {
  const calls: string[] = [];
  const scheduler = { start: () => calls.push("start"), stop: () => calls.push("stop") };
  const coordinator = createCaptureSchedulerCoordinator(scheduler);

  coordinator.applyKnownState(true);
  coordinator.applyKnownState(false);

  assert.deepEqual(calls, ["start", "stop"]);
});

test("다른 확정 상태가 없으면 부팅 확인이 getActive() 결과대로 적용된다", async () => {
  const calls: string[] = [];
  const scheduler = { start: () => calls.push("start"), stop: () => calls.push("stop") };
  const coordinator = createCaptureSchedulerCoordinator(scheduler);

  await coordinator.applyBootCheck(() => Promise.resolve({
    ok: true as const,
    data: { sessionId: "a", startedAt: "2026-07-22T00:00:00Z" },
  }));

  assert.deepEqual(calls, ["start"]);
});

test("getActive() 실패는 stop으로 취급한다", async () => {
  const calls: string[] = [];
  const scheduler = { start: () => calls.push("start"), stop: () => calls.push("stop") };
  const coordinator = createCaptureSchedulerCoordinator(scheduler);

  await coordinator.applyBootCheck(() => Promise.resolve({
    ok: false as const,
    error: { code: "unknown", message: "실패" },
  }));

  assert.deepEqual(calls, ["stop"]);
});

// doyeonid 리뷰(PR #92) P1 재검토가 지적한 정확한 상황을 재현한다: 부팅 확인이 아직
// 끝나지 않은 사이 study:end가 성공한다. 이전(mutex 기반) 수정은 최종 상태만 맞추고
// 그 사이 start가 잠깐이라도 불리는 걸 막지 못했다 — 이번엔 study:end 이후 start가
// "전혀" 불리지 않아야 한다.
test("부팅 확인이 끝나기 전에 study:end가 성공하면, 부팅 확인은 start를 전혀 부르지 않는다", async () => {
  const calls: string[] = [];
  const scheduler = { start: () => calls.push("start"), stop: () => calls.push("stop") };
  const coordinator = createCaptureSchedulerCoordinator(scheduler);

  const bootGetActive = deferred<{ ok: true; data: { sessionId: string; startedAt: string } | undefined }>();
  const bootCheck = coordinator.applyBootCheck(() => bootGetActive.promise);

  // study:end가 부팅 확인보다 먼저 성공적으로 끝난다 — 즉시 stop.
  coordinator.applyKnownState(false);
  assert.deepEqual(calls, ["stop"]);

  // 부팅 쪽 fs 읽기가 뒤늦게 "그때는 세션이 있었다"고 응답해도
  bootGetActive.resolve({ ok: true, data: { sessionId: "a", startedAt: "2026-07-22T00:00:00Z" } });
  await bootCheck;

  // start는 한 번도 불리지 않는다 — 세대가 바뀌어 부팅 확인 결과가 통째로 버려진다.
  assert.deepEqual(calls, ["stop"]);
});

test("부팅 확인이 끝나기 전에 study:start가 성공하면, 부팅 확인은 결과를 무시한다", async () => {
  const calls: string[] = [];
  const scheduler = { start: () => calls.push("start"), stop: () => calls.push("stop") };
  const coordinator = createCaptureSchedulerCoordinator(scheduler);

  const bootGetActive = deferred<{ ok: true; data: undefined }>();
  const bootCheck = coordinator.applyBootCheck(() => bootGetActive.promise);

  coordinator.applyKnownState(true); // study:start가 먼저 성공 — 즉시 start
  assert.deepEqual(calls, ["start"]);

  bootGetActive.resolve({ ok: true, data: undefined }); // 부팅 쪽은 "세션 없음"으로 뒤늦게 응답
  await bootCheck;

  // stop은 불리지 않는다 — 이미 study:start가 만든 최신 상태를 부팅 확인이 덮어쓰지 않는다.
  assert.deepEqual(calls, ["start"]);
});
