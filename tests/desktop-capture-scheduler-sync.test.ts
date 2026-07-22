import assert from "node:assert/strict";
import test from "node:test";

import { createCaptureSchedulerSync } from "../apps/desktop/src/main/study/captureSchedulerSync.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

test("세션이 있으면 start, 없으면 stop을 호출한다", async () => {
  const calls: string[] = [];
  const scheduler = { start: () => calls.push("start"), stop: () => calls.push("stop") };

  const withSession = createCaptureSchedulerSync({
    getActive: () => Promise.resolve({ ok: true as const, data: { sessionId: "a", startedAt: "2026-07-22T00:00:00Z" } }),
    scheduler,
  });
  await withSession.sync();
  assert.deepEqual(calls, ["start"]);

  const withoutSession = createCaptureSchedulerSync({
    getActive: () => Promise.resolve({ ok: true as const, data: undefined }),
    scheduler,
  });
  await withoutSession.sync();
  assert.deepEqual(calls, ["start", "stop"]);
});

test("getActive() 실패도 stop으로 취급한다(안전한 기본값)", async () => {
  const calls: string[] = [];
  const scheduler = { start: () => calls.push("start"), stop: () => calls.push("stop") };
  const sync = createCaptureSchedulerSync({
    getActive: () => Promise.resolve({ ok: false as const, error: { code: "unknown", message: "실패" } }),
    scheduler,
  });
  await sync.sync();
  assert.deepEqual(calls, ["stop"]);
});

// doyeonid 리뷰(PR #92) P1이 지적한 정확한 상황을 재현한다: 부팅 시 복원 확인이
// study:end 재확인보다 늦게 끝나더라도, 뒤에 큐에 들어간 재확인이 최종 상태를 결정해야
// 한다(먼저 끝난 쪽이 이기면 안 된다).
test("먼저 큐에 들어간 확인이 늦게 끝나도, 나중에 큐에 들어간 확인이 최종 상태를 결정한다", async () => {
  const calls: string[] = [];
  const scheduler = { start: () => calls.push("start"), stop: () => calls.push("stop") };

  const bootDeferred = deferred<{ ok: true; data: { sessionId: string; startedAt: string } | undefined }>();
  let callIndex = 0;
  const sync = createCaptureSchedulerSync({
    getActive: () => {
      callIndex += 1;
      // 1번째 호출(부팅 시 복원 확인)은 일부러 응답을 미룬다.
      if (callIndex === 1) return bootDeferred.promise;
      // 2번째 호출(study:end 직후 재확인)은 이미 세션이 끝났다고 즉시 응답한다.
      return Promise.resolve({ ok: true as const, data: undefined });
    },
    scheduler,
  });

  const bootSync = sync.sync();
  const endSync = sync.sync(); // 락 때문에 bootSync의 getActive()가 끝나야 실제로 실행된다

  // 부팅 쪽 fs 읽기가 뒤늦게 "그때는 세션이 있었다"고 응답한다.
  bootDeferred.resolve({ ok: true, data: { sessionId: "a", startedAt: "2026-07-22T00:00:00Z" } });
  await bootSync;
  await endSync;

  // 부팅 확인이 먼저 실행돼 일단 start를 부르지만, 그다음 차례인 종료 재확인이
  // 최신 상태(세션 없음)를 다시 읽어 최종적으로는 stop으로 수렴한다.
  assert.deepEqual(calls, ["start", "stop"]);
});
