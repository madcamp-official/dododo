import assert from "node:assert/strict";
import test from "node:test";

import { runAdvise } from "../apps/cli/src/commands/advise.ts";
import { createCliContainer } from "../apps/cli/src/runtime/container.ts";
import { defaultScreenAdvicePolicy, LlmScreenAdvicePolicy } from "../apps/cli/src/runtime/adviceLookup.ts";
import type { LLMJSONRequest, LLMProvider } from "../packages/context-engine/src/index.ts";
import type { ContextItem, PrivacyGateway, RawItem } from "../packages/shared/src/index.ts";

function fakeAdviceProvider(adviceText = "테스트 조언"): LLMProvider {
  return {
    async completeJSON<T>(request: LLMJSONRequest<T>): Promise<T> {
      const value = { advice: adviceText };
      if (!request.validate(value)) throw new Error("응답이 스키마를 통과하지 못했습니다");
      return value;
    },
  };
}

const passthroughGateway: PrivacyGateway = {
  async prepare(rawItem) {
    return rawItem;
  },
};

function screenActivity(overrides: Partial<RawItem> = {}): RawItem {
  return {
    id: "screen-manual-abc123",
    sourceId: "screen-manual",
    sourceType: "screen",
    uri: "screen://screen-manual/2026-07-18T15:20:00+09:00",
    content: "운영체제 교재의 프로세스 스케줄링 단원을 공부 중",
    contentHash: "hash",
    observedAt: "2026-07-18T15:20:00+09:00",
    metadata: { relatedTaskCandidate: "운영체제 시험 대비", confidence: 0.82 },
    ...overrides,
  };
}

function taskItem(overrides: Partial<ContextItem> = {}): ContextItem {
  return {
    id: "task-1",
    kind: "task",
    title: "운영체제 시험 대비",
    status: "new",
    requirements: [],
    tags: [],
    priority: 0,
    confidence: 0.9,
    evidenceIds: ["evidence-1"],
    metadata: {},
    createdAt: "2026-07-18T00:00:00+09:00",
    updatedAt: "2026-07-18T00:00:00+09:00",
    ...overrides,
  };
}

test("relatedTaskCandidate와 겹치는 Task가 있으면 조언한다", async () => {
  const decision = await defaultScreenAdvicePolicy.evaluate({
    activity: screenActivity(),
    contextItems: [taskItem()],
    now: new Date("2026-07-18T15:20:00+09:00"),
  });

  assert.equal(decision.advise, true);
  assert.match(decision.message ?? "", /운영체제 시험 대비/);
  assert.deepEqual(decision.evidenceIds, ["evidence-1"]);
});

test("관련 Task가 없으면 거절한다", async () => {
  const decision = await defaultScreenAdvicePolicy.evaluate({
    activity: screenActivity(),
    contextItems: [taskItem({ title: "다른 과목 발표 준비" })],
    now: new Date("2026-07-18T15:20:00+09:00"),
  });

  assert.equal(decision.advise, false);
  assert.match(decision.declineReason ?? "", /관련된 Task를 찾지 못했습니다/);
});

test("confidence가 낮으면 거절한다", async () => {
  const decision = await defaultScreenAdvicePolicy.evaluate({
    activity: screenActivity({ metadata: { relatedTaskCandidate: "운영체제 시험 대비", confidence: 0.2 } }),
    contextItems: [taskItem()],
    now: new Date("2026-07-18T15:20:00+09:00"),
  });

  assert.equal(decision.advise, false);
  assert.match(decision.declineReason ?? "", /확신도가 낮습니다/);
});

test("runAdvise --screen은 매치되는 Task가 있으면 조언 문구를 반환한다", async () => {
  const container = createCliContainer({ databasePath: ":memory:" });
  await container.repository.saveContextItems([taskItem()]);
  const before = await container.repository.listContextItems();

  const output = await runAdvise(container, ["--screen"], new Date("2026-07-18T15:20:00+09:00"));

  assert.match(output, /화면 기반 조언/);
  assert.match(output, /운영체제 시험 대비/);
  const after = await container.repository.listContextItems();
  assert.equal(after.length, before.length);
});

test("runAdvise --screen은 매치되는 Task가 없으면 거절 문구를 반환한다", async () => {
  const container = createCliContainer({ databasePath: ":memory:" });

  const output = await runAdvise(container, ["--screen"], new Date("2026-07-18T15:20:00+09:00"));

  assert.match(output, /조언하지 않습니다/);
  assert.match(output, /관련된 Task를 찾지 못했습니다/);
});

test("runAdvise는 --screen이 없으면 사용법을 보여준다", async () => {
  const container = createCliContainer({ databasePath: ":memory:" });
  const output = await runAdvise(container, []);
  assert.match(output, /사용법: dododo advise --screen/);
});

test("runAdvise --screen --live는 캡처 성공 시 Vision 미연결 안내를 반환한다", async () => {
  const container = createCliContainer({ databasePath: ":memory:" });
  container.captureLiveScreen = async () => ({
    capturedAt: new Date("2026-07-20T10:00:00+09:00"),
    byteLength: 12345,
    imageBase64: "fake",
  });

  const output = await runAdvise(container, ["--screen", "--live"]);

  assert.match(output, /실시간 화면 캡처 완료/);
  assert.match(output, /12345 bytes/);
  assert.match(output, /Vision 분석이 아직 연결되지 않아/);
  assert.doesNotMatch(output, /fake/);
});

test("runAdvise --screen --live는 캡처 실패를 명확한 오류로 보여준다", async () => {
  const container = createCliContainer({ databasePath: ":memory:" });
  container.captureLiveScreen = async () => {
    throw new Error("실제 화면 캡처는 현재 Windows만 지원합니다 (현재 플랫폼: linux)");
  };

  const output = await runAdvise(container, ["--screen", "--live"]);

  assert.match(output, /실시간 화면 캡처에 실패했습니다/);
  assert.match(output, /Windows만 지원/);
});

test("relatedTaskCandidate가 없으면 거절한다", async () => {
  const decision = await defaultScreenAdvicePolicy.evaluate({
    activity: screenActivity({ metadata: { confidence: 0.9 } }),
    contextItems: [taskItem()],
    now: new Date("2026-07-18T15:20:00+09:00"),
  });

  assert.equal(decision.advise, false);
  assert.match(decision.declineReason ?? "", /관련 작업 후보를 찾지 못했습니다/);
});

test("LlmScreenAdvicePolicy는 관련 Task를 찾으면 LLM 조언을 반환한다", async () => {
  const policy = new LlmScreenAdvicePolicy(fakeAdviceProvider("스케줄링 단원을 복습하세요"), passthroughGateway);

  const decision = await policy.evaluate({
    activity: screenActivity(),
    contextItems: [taskItem()],
    now: new Date("2026-07-18T15:20:00+09:00"),
  });

  assert.equal(decision.advise, true);
  assert.equal(decision.message, "스케줄링 단원을 복습하세요");
  assert.deepEqual(decision.evidenceIds, ["evidence-1"]);
});

test("LlmScreenAdvicePolicy는 관련 Task가 없으면 거절한다", async () => {
  const policy = new LlmScreenAdvicePolicy(fakeAdviceProvider(), passthroughGateway);

  const decision = await policy.evaluate({
    activity: screenActivity(),
    contextItems: [taskItem({ title: "완전히 다른 과목 발표 준비" })],
    now: new Date("2026-07-18T15:20:00+09:00"),
  });

  assert.equal(decision.advise, false);
  assert.match(decision.declineReason ?? "", /찾지 못했거나/);
});

test("LlmScreenAdvicePolicy는 --focus면 조언하지 않는다", async () => {
  const policy = new LlmScreenAdvicePolicy(fakeAdviceProvider(), passthroughGateway);

  const decision = await policy.evaluate({
    activity: screenActivity(),
    contextItems: [taskItem()],
    now: new Date("2026-07-18T15:20:00+09:00"),
    focusMode: true,
  });

  assert.equal(decision.advise, false);
  assert.match(decision.declineReason ?? "", /집중 모드/);
});

test("LlmScreenAdvicePolicy는 같은 Task에 30분 이내 재조언하지 않는다", async () => {
  const policy = new LlmScreenAdvicePolicy(fakeAdviceProvider(), passthroughGateway);
  const first = await policy.evaluate({
    activity: screenActivity(),
    contextItems: [taskItem()],
    now: new Date("2026-07-18T15:20:00+09:00"),
  });
  assert.equal(first.advise, true);

  const second = await policy.evaluate({
    activity: screenActivity(),
    contextItems: [taskItem()],
    now: new Date("2026-07-18T15:21:00+09:00"),
  });

  assert.equal(second.advise, false);
});
