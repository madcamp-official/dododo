import assert from "node:assert/strict";
import test from "node:test";

import { renderHelp } from "../apps/cli/src/commands/help.ts";
import { FixtureCollector } from "../packages/collectors/src/index.ts";
import {
  ContextPipeline,
  DeterministicContextResolver,
} from "../packages/context-engine/src/index.ts";
import { InterimContextStore } from "../packages/context-engine/src/index.ts";
import { calculateBinaryMetrics } from "../packages/evaluation/src/index.ts";
import { AllowlistPrivacyGateway } from "../packages/privacy/src/index.ts";
import { InMemoryContextRepository } from "../packages/storage/src/index.ts";

test("CLI help exposes the core MVP commands", () => {
  const help = renderHelp();
  assert.match(help, /sync/);
  assert.match(help, /inbox/);
  assert.match(help, /today/);
  assert.match(help, /advise/);
});

test("in-memory repository starts empty", async () => {
  const repository = new InMemoryContextRepository();
  assert.deepEqual(await repository.listContextItems(), []);
});

test("evaluation metrics calculate precision, recall and f1", () => {
  assert.deepEqual(calculateBinaryMetrics(8, 2, 2), {
    precision: 0.8,
    recall: 0.8,
    f1: 0.8000000000000002,
  });
});

test("fixture data can pass through the module contracts", async () => {
  const repository = new InMemoryContextRepository();
  const collector = new FixtureCollector("school-site", "school-site", [{
    id: "raw-1",
    sourceId: "school-site",
    sourceType: "school-site",
    uri: "fixture://notice/1",
    title: "AI 해커톤",
    content: "7월 25일까지 신청",
    contentHash: "hash-1",
    observedAt: "2026-07-18T09:00:00+09:00",
    metadata: {},
  }]);
  const pipeline = new ContextPipeline({
    repository,
    privacyGateway: new AllowlistPrivacyGateway(["school-site"]),
    factExtractor: {
      async extract(rawItem) {
        return [{
          id: "fact-1",
          rawItemId: rawItem.id,
          kind: "opportunity",
          subject: "AI 해커톤",
          value: "참가자 모집",
          confidence: 0.95,
          evidenceText: rawItem.content,
        }];
      },
    },
    contextResolver: new DeterministicContextResolver(),
  });

  const result = await pipeline.sync(collector);

  assert.equal(result.errors.length, 0);
  assert.equal(result.created, 1);
  assert.equal((await repository.listContextItems("opportunity")).length, 1);
});

test("InterimContextStore round-trips evidence, history and recommendations", async () => {
  const store = new InterimContextStore();

  await store.saveEvidence([{
    id: "ev-1",
    rawItemId: "raw-1",
    sourceType: "school-site",
    location: "fixture://notice/1",
    quote: "신청 마감은 7월 25일입니다.",
    observedAt: "2026-07-18T09:00:00+09:00",
    authority: "official",
  }]);
  assert.equal((await store.listEvidence(["ev-1", "missing"])).length, 1);

  await store.saveContextHistory([{
    id: "hist-1",
    contextItemId: "ctx-1",
    changeType: "field_updated",
    field: "deadline",
    previousValue: "2026-07-21T18:00:00+09:00",
    newValue: "2026-07-23T18:00:00+09:00",
    evidenceId: "ev-1",
    changedAt: "2026-07-18T10:00:00+09:00",
  }]);
  assert.equal((await store.listContextHistory("ctx-1")).length, 1);
  assert.equal((await store.listContextHistory("ctx-unknown")).length, 0);

  await store.saveRecommendations([{
    id: "rec-1",
    contextItemId: "ctx-1",
    action: "제출 준비를 시작하세요.",
    reason: "마감이 가까움",
    score: 80,
    evidenceIds: ["ev-1"],
    createdAt: "2026-07-18T10:00:00+09:00",
  }]);
  assert.equal((await store.listRecommendations("ctx-1")).length, 1);
  assert.equal((await store.listRecommendations()).length, 1);
});
