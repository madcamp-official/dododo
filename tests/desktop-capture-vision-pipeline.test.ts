import assert from "node:assert/strict";
import test from "node:test";

import { createCaptureVisionPipeline } from "../apps/desktop/src/main/study/captureVisionPipeline.ts";
import type { LLMProvider } from "../packages/context-engine/src/index.ts";
import type { ContextItem } from "../packages/shared/src/index.ts";
import type { ScreenAdvicePolicy } from "../apps/cli/src/runtime/adviceLookup.ts";

const OBSERVED_AT = new Date("2026-07-22T09:00:00Z");

interface VisionActivityStub {
  application: string;
  activityType: string;
  taskCandidate?: string;
  sensitiveContentDetected: boolean;
  confidence: number;
}

function fakeProvider(response: VisionActivityStub): LLMProvider {
  return {
    imageDataBoundary: "local",
    completeJSON: async <T>() => response as unknown as T,
  };
}

function taskItem(overrides: Partial<ContextItem> = {}): ContextItem {
  return {
    id: "task-1",
    kind: "task",
    title: "운영체제 과제 3",
    status: "todo",
    requirements: [],
    tags: [],
    priority: 0,
    confidence: 0.9,
    evidenceIds: ["evidence-1"],
    metadata: {},
    createdAt: OBSERVED_AT.toISOString(),
    updatedAt: OBSERVED_AT.toISOString(),
    ...overrides,
  };
}

function policyReturning(decision: { advise: boolean; message?: string }): ScreenAdvicePolicy {
  return { evaluate: async () => decision };
}

const ON_TASK_VISION: VisionActivityStub = {
  application: "VS Code",
  activityType: "코딩",
  taskCandidate: "운영체제 과제",
  sensitiveContentDetected: false,
  confidence: 0.9,
};

interface HarnessOptions {
  activeSessions?: Array<{ sessionId: string; startedAt: string } | undefined>;
  captureThrows?: boolean;
  isRemote?: boolean;
  withoutProvider?: boolean;
  vision?: VisionActivityStub;
  contextItems?: ContextItem[];
  policyDecision?: { advise: boolean; message?: string };
}

function createHarness(options: HarnessOptions = {}) {
  const activeSessions = options.activeSessions
    ?? [{ sessionId: "session-1", startedAt: OBSERVED_AT.toISOString() }];
  let getActiveCallCount = 0;
  const calls: string[] = [];
  const broadcasts: Array<{ kind: string; message: string }> = [];
  const recordedSessionIds: string[] = [];

  const pipeline = createCaptureVisionPipeline({
    getActiveSession: async () => {
      const index = Math.min(getActiveCallCount, activeSessions.length - 1);
      getActiveCallCount += 1;
      return { ok: true, data: activeSessions[index] };
    },
    recordAdvice: async (sessionId: string) => {
      recordedSessionIds.push(sessionId);
      return { ok: true, data: undefined };
    },
    isRemoteProvider: () => options.isRemote ?? false,
    llmProvider: options.withoutProvider === true ? undefined : fakeProvider(options.vision ?? ON_TASK_VISION),
    captureLiveScreen: async () => {
      calls.push("captureLiveScreen");
      if (options.captureThrows === true) throw new Error("캡처 실패");
      return { imageBase64: "base64", capturedAt: OBSERVED_AT };
    },
    listContextItems: async () => options.contextItems ?? [taskItem()],
    screenAdvicePolicy: policyReturning(options.policyDecision ?? { advise: true, message: "계속 진행하세요." }),
    broadcast: (event) => broadcasts.push({ kind: event.kind, message: event.message }),
    now: () => OBSERVED_AT,
  });

  return { pipeline, calls, broadcasts, recordedSessionIds };
}

test("비활성 세션이면 캡처·Vision을 호출하지 않는다", async () => {
  const { pipeline, calls, broadcasts } = createHarness({ activeSessions: [undefined] });
  await pipeline.run("idle-to-active", OBSERVED_AT);
  assert.equal(calls.includes("captureLiveScreen"), false);
  assert.deepEqual(broadcasts, []);
});

test("원격 Provider면 캡처하지 않는다", async () => {
  const { pipeline, calls } = createHarness({ isRemote: true });
  await pipeline.run("idle-to-active", OBSERVED_AT);
  assert.equal(calls.includes("captureLiveScreen"), false);
});

test("llmProvider가 없으면 캡처하지 않는다", async () => {
  const { pipeline, calls } = createHarness({ withoutProvider: true });
  await pipeline.run("idle-to-active", OBSERVED_AT);
  assert.equal(calls.includes("captureLiveScreen"), false);
});

test("캡처 실패는 이 trigger만 조용히 건너뛰고 다음 trigger는 정상 처리한다", async () => {
  const { pipeline, broadcasts } = createHarness({ captureThrows: true });
  await pipeline.run("idle-to-active", OBSERVED_AT);
  assert.deepEqual(broadcasts, []);

  const { pipeline: nextPipeline, broadcasts: nextBroadcasts } = createHarness();
  await nextPipeline.run("idle-to-active", OBSERVED_AT);
  assert.equal(nextBroadcasts.length, 1);
  assert.equal(nextBroadcasts[0]?.kind, "advice");
});

test("Vision 실패(민감 콘텐츠 등)도 조용히 건너뛴다", async () => {
  const { pipeline, broadcasts, recordedSessionIds } = createHarness({
    vision: { application: "?", activityType: "?", sensitiveContentDetected: true, confidence: 0.9 },
  });
  await pipeline.run("idle-to-active", OBSERVED_AT);
  assert.deepEqual(broadcasts, []);
  assert.deepEqual(recordedSessionIds, []);
});

test("관련 Task를 찾으면 advice 알림을 보내고 그 세션에 adviceCount를 기록한다", async () => {
  const { pipeline, broadcasts, recordedSessionIds } = createHarness();
  await pipeline.run("idle-to-active", OBSERVED_AT);
  assert.equal(broadcasts.length, 1);
  assert.equal(broadcasts[0]?.kind, "advice");
  assert.equal(broadcasts[0]?.message, "계속 진행하세요.");
  assert.deepEqual(recordedSessionIds, ["session-1"]);
});

test("관련 Task를 못 찾으면(연결 자체가 안 되면) distraction 알림을 보내고 adviceCount는 늘리지 않는다", async () => {
  const { pipeline, broadcasts, recordedSessionIds } = createHarness({ contextItems: [] });
  await pipeline.run("idle-to-active", OBSERVED_AT);
  assert.equal(broadcasts.length, 1);
  assert.equal(broadcasts[0]?.kind, "distraction");
  assert.deepEqual(recordedSessionIds, []);
});

test("관련 Task는 찾았지만 정책이 조언을 억제하면(예: 최근 조언) 아무 알림도 안 보낸다", async () => {
  const { pipeline, broadcasts, recordedSessionIds } = createHarness({ policyDecision: { advise: false } });
  await pipeline.run("idle-to-active", OBSERVED_AT);
  assert.deepEqual(broadcasts, []);
  assert.deepEqual(recordedSessionIds, []);
});

test("캡처 이후 세션이 끝나면 알림도, adviceCount 기록도 하지 않는다", async () => {
  const { pipeline, broadcasts, recordedSessionIds } = createHarness({
    activeSessions: [
      { sessionId: "session-1", startedAt: OBSERVED_AT.toISOString() }, // trigger 시작 시점 확인
      undefined, // 캡처 이후 재확인 — 그 사이 study:end가 성공함
    ],
  });
  await pipeline.run("idle-to-active", OBSERVED_AT);
  assert.deepEqual(broadcasts, []);
  assert.deepEqual(recordedSessionIds, []);
});

test("예상치 못한 예외는 밖으로 던지지 않고 onError로만 전달한다", async () => {
  const errors: unknown[] = [];
  const pipeline = createCaptureVisionPipeline({
    getActiveSession: async () => ({ ok: true, data: { sessionId: "s", startedAt: OBSERVED_AT.toISOString() } }),
    recordAdvice: async () => ({ ok: true, data: undefined }),
    isRemoteProvider: () => false,
    llmProvider: fakeProvider(ON_TASK_VISION),
    captureLiveScreen: async () => ({ imageBase64: "x", capturedAt: OBSERVED_AT }),
    listContextItems: async () => {
      throw new Error("저장소 오류");
    },
    screenAdvicePolicy: policyReturning({ advise: false }),
    broadcast: () => {
      throw new Error("호출되면 안 됨");
    },
    onError: (error) => errors.push(error),
  });

  await assert.doesNotReject(() => pipeline.run("idle-to-active", OBSERVED_AT));
  assert.equal(errors.length, 1);
});
