import assert from "node:assert/strict";
import test from "node:test";

import { runAdvise } from "../apps/cli/src/commands/advise.ts";
import { createCliContainer } from "../apps/cli/src/runtime/container.ts";
import { defaultScreenAdvicePolicy } from "../apps/cli/src/runtime/adviceLookup.ts";
import type { ContextItem, RawItem } from "../packages/shared/src/index.ts";

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
  const container = createCliContainer();
  await container.repository.saveContextItems([taskItem()]);
  const before = await container.repository.listContextItems();

  const output = await runAdvise(container, ["--screen"], new Date("2026-07-18T15:20:00+09:00"));

  assert.match(output, /화면 기반 조언/);
  assert.match(output, /운영체제 시험 대비/);
  const after = await container.repository.listContextItems();
  assert.equal(after.length, before.length);
});

test("runAdvise --screen은 매치되는 Task가 없으면 거절 문구를 반환한다", async () => {
  const container = createCliContainer();

  const output = await runAdvise(container, ["--screen"], new Date("2026-07-18T15:20:00+09:00"));

  assert.match(output, /조언하지 않습니다/);
  assert.match(output, /관련된 Task를 찾지 못했습니다/);
});

test("runAdvise는 --screen이 없으면 사용법을 보여준다", async () => {
  const container = createCliContainer();
  const output = await runAdvise(container, []);
  assert.match(output, /사용법: dododo advise --screen/);
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
