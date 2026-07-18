import assert from "node:assert/strict";
import test from "node:test";

import { renderHelp } from "../apps/cli/src/commands/help.ts";
import { FixtureCollector } from "../packages/collectors/src/index.ts";
import {
  classifyConfidenceGate,
  contextKindForFact,
  ContextPipeline,
  DeterministicContextResolver,
  InterimContextStore,
  LLMFactExtractor,
} from "../packages/context-engine/src/index.ts";
import type { LLMJSONRequest, LLMProvider } from "../packages/context-engine/src/index.ts";
import { calculateBinaryMetrics } from "../packages/evaluation/src/index.ts";
import { AllowlistPrivacyGateway } from "../packages/privacy/src/index.ts";
import { InMemoryContextRepository } from "../packages/storage/src/index.ts";
import type { Fact, RawItem } from "../packages/shared/src/index.ts";

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

class FakeLLMProvider implements LLMProvider {
  private readonly result: () => Promise<unknown>;

  constructor(result: () => Promise<unknown>) {
    this.result = result;
  }

  async completeJSON<T>(request: LLMJSONRequest<T>): Promise<T> {
    const value = await this.result();
    if (!request.validate(value)) {
      throw new Error("fake provider response failed validate()");
    }
    return value;
  }
}

const sampleRawItem: RawItem = {
  id: "raw-lms-001",
  sourceId: "lms-main",
  sourceType: "lms",
  uri: "https://lms.example/courses/os/assignments/3",
  title: "운영체제 과제 3",
  content: "과제 3은 2026년 7월 22일 23시 59분까지 보고서 PDF와 소스코드 ZIP을 제출합니다.",
  contentHash: "fixture-lms-001",
  observedAt: "2026-07-18T09:20:00+09:00",
  metadata: { course: "운영체제", official: true },
};

test("LLMFactExtractor는 Schema를 통과한 유효한 응답을 Fact로 변환한다", async () => {
  const provider = new FakeLLMProvider(async () => ({
    facts: [{
      kind: "task",
      subject: "운영체제 과제 3",
      value: "보고서 PDF와 소스코드 ZIP 제출",
      eventTime: "2026-07-22T23:59:00+09:00",
      confidence: 0.92,
      evidenceText: "2026년 7월 22일 23시 59분까지 보고서 PDF와 소스코드 ZIP을 제출합니다.",
    }],
  }));
  const extractor = new LLMFactExtractor(provider);

  const facts = await extractor.extract(sampleRawItem);

  assert.equal(facts.length, 1);
  assert.equal(facts[0]?.rawItemId, sampleRawItem.id);
  assert.equal(facts[0]?.kind, "task");
  assert.equal(facts[0]?.confidence, 0.92);
});

test("LLMFactExtractor는 Provider 실패를 삼키고 빈 배열을 반환한다", async () => {
  const provider = new FakeLLMProvider(async () => {
    throw new Error("LLM 서버에 연결할 수 없습니다");
  });
  const extractor = new LLMFactExtractor(provider);

  const facts = await extractor.extract(sampleRawItem);

  assert.deepEqual(facts, []);
});

test("LLMFactExtractor는 원문에 없는 evidenceText를 가진 Fact를 버린다", async () => {
  const provider = new FakeLLMProvider(async () => ({
    facts: [
      {
        kind: "task",
        subject: "운영체제 과제 3",
        value: "보고서 PDF와 소스코드 ZIP 제출",
        confidence: 0.9,
        evidenceText: "원문에 없는 지어낸 문장입니다.",
      },
      {
        kind: "task",
        subject: "운영체제 과제 3",
        value: "보고서 PDF와 소스코드 ZIP 제출",
        confidence: 0.9,
        evidenceText: "보고서 PDF와 소스코드 ZIP을 제출합니다.",
      },
    ],
  }));
  const extractor = new LLMFactExtractor(provider);

  const facts = await extractor.extract(sampleRawItem);

  assert.equal(facts.length, 1);
  assert.match(facts[0]?.evidenceText ?? "", /보고서 PDF와 소스코드 ZIP을 제출합니다/);
});

test("LLMFactExtractor는 Schema를 통과하지 못한 응답이면 빈 배열을 반환한다", async () => {
  const provider = new FakeLLMProvider(async () => ({ facts: "not-an-array" }));
  const extractor = new LLMFactExtractor(provider);

  const facts = await extractor.extract(sampleRawItem);

  assert.deepEqual(facts, []);
});

test("파이프라인을 거치면 DeterministicContextResolver가 ContextItem에 Evidence를 채운다", async () => {
  const repository = new InMemoryContextRepository();
  const collector = new FixtureCollector("lms-main", "lms", [{
    id: "raw-lms-001",
    sourceId: "lms-main",
    sourceType: "lms",
    uri: "https://lms.example/courses/os/assignments/3",
    title: "운영체제 과제 3",
    content: "과제 3은 2026년 7월 22일 23시 59분까지 제출합니다.",
    contentHash: "hash-lms-1",
    observedAt: "2026-07-18T09:20:00+09:00",
    metadata: { course: "운영체제", official: true },
  }]);
  const pipeline = new ContextPipeline({
    repository,
    privacyGateway: new AllowlistPrivacyGateway(["lms"]),
    factExtractor: {
      async extract(rawItem) {
        return [{
          id: "fact-os-3",
          rawItemId: rawItem.id,
          kind: "task",
          subject: "운영체제 과제 3",
          value: "제출",
          eventTime: "2026-07-22T23:59:00+09:00",
          confidence: 0.9,
          evidenceText: "2026년 7월 22일 23시 59분까지 제출합니다.",
        }];
      },
    },
    contextResolver: new DeterministicContextResolver(),
  });

  await pipeline.sync(collector);

  const items = await repository.listContextItems("task");
  assert.equal(items.length, 1);
  assert.equal(items[0]?.evidenceIds.length, 1);
  assert.equal(items[0]?.status, "new");

  const evidence = await pipeline.evidenceStore.listEvidence(items[0]?.evidenceIds ?? []);
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.authority, "official");
  assert.equal(evidence[0]?.quote, "2026년 7월 22일 23시 59분까지 제출합니다.");
});

test("narrow ContextResolver mock을 넣어도 파이프라인이 정상 동작한다", async () => {
  const repository = new InMemoryContextRepository();
  const collector = new FixtureCollector("school-site", "school-site", [{
    id: "raw-narrow-1",
    sourceId: "school-site",
    sourceType: "school-site",
    uri: "fixture://notice/2",
    title: "임시 공지",
    content: "테스트",
    contentHash: "hash-narrow-1",
    observedAt: "2026-07-18T09:00:00+09:00",
    metadata: {},
  }]);
  const pipeline = new ContextPipeline({
    repository,
    privacyGateway: new AllowlistPrivacyGateway(["school-site"]),
    factExtractor: {
      async extract(rawItem) {
        return [{
          id: "fact-narrow-1",
          rawItemId: rawItem.id,
          kind: "note",
          subject: "임시 공지",
          value: "테스트",
          confidence: 0.9,
          evidenceText: rawItem.content,
        }];
      },
    },
    // resolveWithEvidence가 없는 narrow ContextResolver — isEvidenceAware가 false를
    // 반환해 파이프라인이 좁은 resolve()로 폴백해야 한다.
    contextResolver: {
      async resolve(facts) {
        return facts.map((fact) => ({
          id: `ctx-${fact.id}`,
          kind: "note",
          title: fact.subject,
          status: "new",
          requirements: [],
          tags: [],
          priority: 0,
          confidence: fact.confidence,
          evidenceIds: [],
          metadata: {},
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }));
      },
    },
  });

  const result = await pipeline.sync(collector);

  assert.equal(result.errors.length, 0);
  assert.equal(result.created, 1);
});

const baseFact: Fact = {
  id: "f-base",
  rawItemId: "r-base",
  kind: "task",
  subject: "제목",
  value: "값",
  confidence: 0.9,
  evidenceText: "근거",
};

test("classifyConfidenceGate는 낮은 확신도를 candidate로 둔다", () => {
  const fact: Fact = { ...baseFact, confidence: 0.5 };
  assert.equal(classifyConfidenceGate(fact), "candidate");
});

test("classifyConfidenceGate는 시각 표현이 없는 마감을 candidate로 둔다", () => {
  const fact: Fact = {
    ...baseFact,
    kind: "deadline",
    eventTime: "2026-07-25T00:00:00+09:00",
    confidence: 0.9,
  };
  assert.equal(classifyConfidenceGate(fact), "candidate");
});

test("classifyConfidenceGate는 확신도와 명확한 시각이 있으면 new로 확정한다", () => {
  const fact: Fact = {
    ...baseFact,
    kind: "deadline",
    eventTime: "2026-07-25T18:00:00+09:00",
    confidence: 0.9,
  };
  assert.equal(classifyConfidenceGate(fact), "new");
});

test("contextKindForFact는 metadata.category가 competition이면 opportunity로 강제한다", () => {
  const fact: Fact = { ...baseFact, kind: "task" };
  const rawItem: RawItem = {
    id: "r-base",
    sourceId: "s1",
    sourceType: "school-site",
    uri: "u",
    content: "c",
    contentHash: "h",
    observedAt: "2026-07-18T00:00:00+09:00",
    metadata: { category: "competition" },
  };
  assert.equal(contextKindForFact(fact, rawItem), "opportunity");
});
