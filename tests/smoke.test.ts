import assert from "node:assert/strict";
import test from "node:test";

import { renderHelp } from "../apps/cli/src/commands/help.ts";
import { FixtureCollector } from "../packages/collectors/src/index.ts";
import {
  buildEvidence,
  classifyConfidenceGate,
  computeMergeScore,
  computePriority,
  contextKindForFact,
  ContextPipeline,
  DeterministicContextResolver,
  generateActionAndReason,
  LLMFactExtractor,
  resolveConflict,
  RuleBasedRecommendationEngine,
} from "../packages/context-engine/src/index.ts";
import type { LLMJSONRequest, LLMProvider } from "../packages/context-engine/src/index.ts";
import { calculateBinaryMetrics } from "../packages/evaluation/src/index.ts";
import { AllowlistPrivacyGateway } from "../packages/privacy/src/index.ts";
import { InMemoryContextRepository } from "../packages/storage/src/index.ts";
import type { ContextItem, Evidence, Fact, RawItem, UserProfile } from "../packages/shared/src/index.ts";

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

test("computeMergeScore는 kind가 다르면 점수와 무관하게 병합을 막는다", () => {
  const existing = {
    id: "ctx-1", kind: "task" as const, title: "대학생 AI 해커톤", status: "new" as const,
    requirements: [], tags: [], priority: 0, confidence: 0.9, evidenceIds: [],
    metadata: {}, createdAt: "", updatedAt: "",
  };
  const rawItem: RawItem = {
    id: "r1", sourceId: "s1", sourceType: "school-site", uri: "u",
    content: "c", contentHash: "h", observedAt: "2026-07-18T00:00:00+09:00", metadata: {},
  };
  const fact: Fact = {
    id: "f1", rawItemId: "r1", kind: "opportunity", subject: "대학생 AI 해커톤",
    value: "v", confidence: 0.9, evidenceText: "e",
  };

  const breakdown = computeMergeScore({ fact, rawItem, kind: "opportunity" }, existing, []);
  assert.equal(breakdown.blocked, true);
  assert.equal(breakdown.total, 0);
});

test("computeMergeScore는 과제 번호가 다르면 제목이 비슷해도 0점 처리한다", () => {
  const existing = {
    id: "ctx-1", kind: "task" as const, title: "운영체제 과제 2", status: "new" as const,
    requirements: [], tags: [], priority: 0, confidence: 0.9, evidenceIds: [],
    metadata: { course: "운영체제" }, createdAt: "", updatedAt: "",
  };
  const rawItem: RawItem = {
    id: "r1", sourceId: "lms-main", sourceType: "lms", uri: "u",
    content: "c", contentHash: "h", observedAt: "2026-07-18T00:00:00+09:00",
    metadata: { course: "운영체제" },
  };
  const fact: Fact = {
    id: "f1", rawItemId: "r1", kind: "task", subject: "운영체제 과제 3",
    value: "v", confidence: 0.9, evidenceText: "e",
  };

  const breakdown = computeMergeScore({ fact, rawItem, kind: "task" }, existing, []);
  assert.equal(breakdown.blocked, true);
  assert.match(breakdown.blockedReason ?? "", /과제 번호 불일치/);
});

test("학교 사이트와 이메일의 같은 공모전은 자동 병합되어 하나의 ContextItem·근거 2개가 된다", async () => {
  const repository = new InMemoryContextRepository();
  const siteRaw: RawItem = {
    id: "raw-school-site-001",
    sourceId: "school-site-main",
    sourceType: "school-site",
    externalId: "notice-1542",
    uri: "https://school.example/notices/1542",
    title: "대학생 AI 해커톤 참가자 모집",
    content: "대학생 AI 해커톤 참가자를 모집합니다. 신청 마감은 2026년 7월 25일 18시입니다.",
    contentHash: "fixture-school-site-001",
    observedAt: "2026-07-18T09:00:00+09:00",
    metadata: { official: true, category: "competition" },
  };
  const emailRaw: RawItem = {
    id: "raw-school-email-001",
    sourceId: "school-email-main",
    sourceType: "school-email",
    externalId: "<ai-hackathon-1542@school.example>",
    uri: "email://school-email-main/ai-hackathon-1542",
    title: "[학생지원팀] 대학생 AI 해커톤 참가자 모집",
    content: "학교 홈페이지에 게시된 AI 해커톤 안내입니다. 신청 마감은 2026년 7월 25일 18시입니다.",
    contentHash: "fixture-school-email-001",
    observedAt: "2026-07-18T09:10:00+09:00",
    metadata: {
      messageId: "<ai-hackathon-1542@school.example>",
      from: "student-support@school.example",
      official: true,
    },
  };

  const pipeline = new ContextPipeline({
    repository,
    privacyGateway: new AllowlistPrivacyGateway(["school-site", "school-email"]),
    factExtractor: {
      async extract(rawItem) {
        return [{
          id: `fact-${rawItem.id}`,
          rawItemId: rawItem.id,
          kind: "opportunity",
          subject: "대학생 AI 해커톤",
          value: "참가자 모집",
          eventTime: "2026-07-25T18:00:00+09:00",
          confidence: 0.9,
          evidenceText: "신청 마감은 2026년 7월 25일 18시입니다.",
        }];
      },
    },
    contextResolver: new DeterministicContextResolver(),
  });

  await pipeline.sync(new FixtureCollector("school-site-main", "school-site", [siteRaw]));
  await pipeline.sync(new FixtureCollector("school-email-main", "school-email", [emailRaw]));

  const opportunities = await repository.listContextItems("opportunity");
  assert.equal(opportunities.length, 1);
  assert.equal(opportunities[0]?.evidenceIds.length, 2);
  assert.equal(opportunities[0]?.deadline, "2026-07-25T18:00:00+09:00");

  const evidence = await pipeline.evidenceStore.listEvidence(opportunities[0]?.evidenceIds ?? []);
  assert.deepEqual(evidence.map((item) => item.sourceType).sort(), ["school-email", "school-site"]);

  const history = await pipeline.evidenceStore.listContextHistory(opportunities[0]?.id ?? "");
  assert.ok(history.some((event) => event.changeType === "merged"));
});

test("수정된 LMS 공지가 기존 마감을 갱신하고 이전 값을 변경 이력에 남긴다", async () => {
  const repository = new InMemoryContextRepository();
  const originalRaw: RawItem = {
    id: "raw-lms-001",
    sourceId: "lms-main",
    sourceType: "lms",
    externalId: "course-os-assignment-3",
    uri: "https://lms.example/courses/os/assignments/3",
    title: "운영체제 과제 3",
    content: "과제 3은 2026년 7월 21일 18시까지 제출합니다.",
    contentHash: "hash-v1",
    observedAt: "2026-07-18T09:20:00+09:00",
    metadata: { course: "운영체제", official: true },
  };
  const revisedRaw: RawItem = {
    ...originalRaw,
    id: "raw-lms-001-rev2",
    content: "과제 3 마감이 2026년 7월 23일 18시로 연장되었습니다.",
    contentHash: "hash-v2",
    observedAt: "2026-07-19T10:00:00+09:00",
  };

  const pipeline = new ContextPipeline({
    repository,
    privacyGateway: new AllowlistPrivacyGateway(["lms"]),
    factExtractor: {
      async extract(rawItem) {
        const isRevision = rawItem.id === "raw-lms-001-rev2";
        return [{
          id: `fact-${rawItem.id}`,
          rawItemId: rawItem.id,
          kind: "task",
          subject: "운영체제 과제 3",
          value: "제출",
          eventTime: isRevision ? "2026-07-23T18:00:00+09:00" : "2026-07-21T18:00:00+09:00",
          confidence: 0.9,
          evidenceText: rawItem.content,
        }];
      },
    },
    contextResolver: new DeterministicContextResolver(),
  });

  await pipeline.sync(new FixtureCollector("lms-main", "lms", [originalRaw]));
  const beforeItems = await repository.listContextItems("task");
  assert.equal(beforeItems[0]?.deadline, "2026-07-21T18:00:00+09:00");

  await pipeline.sync(new FixtureCollector("lms-main", "lms", [revisedRaw]));
  const afterItems = await repository.listContextItems("task");

  assert.equal(afterItems.length, 1);
  assert.equal(afterItems[0]?.deadline, "2026-07-23T18:00:00+09:00");
  assert.equal(afterItems[0]?.evidenceIds.length, 2);

  const history = await pipeline.evidenceStore.listContextHistory(afterItems[0]?.id ?? "");
  const deadlineChange = history.find((event) => event.field === "deadline");
  assert.equal(deadlineChange?.previousValue, "2026-07-21T18:00:00+09:00");
  assert.equal(deadlineChange?.newValue, "2026-07-23T18:00:00+09:00");
});

test("같은 과목의 다른 과제 번호는 병합되지 않고 별도 Task로 남는다", async () => {
  const repository = new InMemoryContextRepository();
  const assignment2: RawItem = {
    id: "raw-lms-002", sourceId: "lms-main", sourceType: "lms",
    externalId: "course-os-assignment-2", uri: "https://lms.example/courses/os/assignments/2",
    title: "운영체제 과제 2", content: "과제 2 제출",
    contentHash: "hash-a2", observedAt: "2026-07-10T09:00:00+09:00",
    metadata: { course: "운영체제", official: true },
  };
  const assignment3: RawItem = {
    id: "raw-lms-003", sourceId: "lms-main", sourceType: "lms",
    externalId: "course-os-assignment-3", uri: "https://lms.example/courses/os/assignments/3",
    title: "운영체제 과제 3", content: "과제 3 제출",
    contentHash: "hash-a3", observedAt: "2026-07-18T09:00:00+09:00",
    metadata: { course: "운영체제", official: true },
  };

  const pipeline = new ContextPipeline({
    repository,
    privacyGateway: new AllowlistPrivacyGateway(["lms"]),
    factExtractor: {
      async extract(rawItem) {
        return [{
          id: `fact-${rawItem.id}`,
          rawItemId: rawItem.id,
          kind: "task",
          subject: rawItem.title ?? "",
          value: "제출",
          eventTime: "2026-07-22T18:00:00+09:00",
          confidence: 0.9,
          evidenceText: rawItem.content,
        }];
      },
    },
    contextResolver: new DeterministicContextResolver(),
  });

  await pipeline.sync(new FixtureCollector("lms-main", "lms", [assignment2]));
  await pipeline.sync(new FixtureCollector("lms-main", "lms", [assignment3]));

  const tasks = await repository.listContextItems("task");
  assert.equal(tasks.length, 2);
  assert.deepEqual(tasks.map((task) => task.title).sort(), ["운영체제 과제 2", "운영체제 과제 3"]);
});

test("40~69점 애매한 병합 후보는 자동 병합도 별도 생성도 아닌 사용자 확인 상태로 남는다", async () => {
  const repository = new InMemoryContextRepository();
  const firstRaw: RawItem = {
    id: "raw-vol-1", sourceId: "school-site-main", sourceType: "school-site",
    externalId: "notice-vol-1", uri: "https://school.example/notices/vol-1",
    title: "여름방학 봉사활동 모집", content: "여름방학 봉사활동 모집합니다. 8월 1일까지 마감.",
    contentHash: "hash-vol-1", observedAt: "2026-07-18T09:00:00+09:00",
    metadata: { official: true },
  };
  const secondRaw: RawItem = {
    id: "raw-vol-2", sourceId: "school-email-main", sourceType: "school-email",
    externalId: "notice-vol-2", uri: "email://school-email-main/vol-2",
    title: "여름방학 봉사활동 지원 안내", content: "여름방학 봉사활동 지원 안내입니다. 8월 1일까지 마감.",
    contentHash: "hash-vol-2", observedAt: "2026-07-19T09:00:00+09:00",
    metadata: { official: true },
  };

  const pipeline = new ContextPipeline({
    repository,
    privacyGateway: new AllowlistPrivacyGateway(["school-site", "school-email"]),
    factExtractor: {
      async extract(rawItem) {
        return [{
          id: `fact-${rawItem.id}`,
          rawItemId: rawItem.id,
          kind: "opportunity",
          subject: rawItem.title ?? "",
          value: "모집",
          eventTime: "2026-08-01T18:00:00+09:00",
          confidence: 0.9,
          evidenceText: rawItem.content,
        }];
      },
    },
    contextResolver: new DeterministicContextResolver(),
  });

  await pipeline.sync(new FixtureCollector("school-site-main", "school-site", [firstRaw]));
  await pipeline.sync(new FixtureCollector("school-email-main", "school-email", [secondRaw]));

  const opportunities = await repository.listContextItems("opportunity");
  assert.equal(opportunities.length, 2);

  const pending = opportunities.find((item) => item.metadata.pendingMergeWithId !== undefined);
  assert.ok(pending !== undefined, "pendingMergeWithId가 설정된 항목이 있어야 한다");
  assert.equal(pending?.status, "candidate");
  assert.equal(typeof pending?.metadata.pendingMergeScore, "number");
  assert.ok((pending?.metadata.pendingMergeScore as number) >= 40);
  assert.ok((pending?.metadata.pendingMergeScore as number) < 70);
});

function emptyProfile(): UserProfile {
  return {
    school: "", major: "", year: "",
    interests: [], activityTypes: [], preferredLocations: [], explicitConstraints: [],
  };
}

function baseItem(overrides: Partial<ContextItem> = {}): ContextItem {
  return {
    id: "ctx-base",
    kind: "task",
    title: "테스트 항목",
    status: "new",
    requirements: [],
    tags: ["task"],
    priority: 0,
    confidence: 0.9,
    evidenceIds: ["ev-1"],
    metadata: {},
    createdAt: "2026-07-18T00:00:00+09:00",
    updatedAt: "2026-07-18T00:00:00+09:00",
    ...overrides,
  };
}

test("computePriority는 이미 지난 마감(overdue)도 40점에서 캡한다", () => {
  const now = new Date("2026-07-20T00:00:00+09:00");
  const overdueItem = baseItem({ deadline: "2026-07-01T00:00:00+09:00" });
  const justNowItem = baseItem({ deadline: "2026-07-20T00:00:00+09:00" });

  const overdue = computePriority(overdueItem, [], { now, profile: emptyProfile(), recentRecommendations: [] });
  const justNow = computePriority(justNowItem, [], { now, profile: emptyProfile(), recentRecommendations: [] });

  assert.equal(overdue.deadlineUrgency, 40);
  assert.equal(justNow.deadlineUrgency, 40);
});

test("computePriority는 done·cancelled·dismissed·snooze 상태를 항상 제외한다", () => {
  const now = new Date("2026-07-18T00:00:00+09:00");
  const ctx = { now, profile: emptyProfile(), recentRecommendations: [] };

  for (const status of ["done", "cancelled", "dismissed", "expired"] as const) {
    const breakdown = computePriority(baseItem({ status }), [], ctx);
    assert.equal(breakdown.excluded, true, `${status}는 제외되어야 한다`);
    assert.equal(breakdown.total, -Infinity);
  }

  const snoozed = baseItem({ metadata: { snoozedUntil: "2026-07-19T00:00:00+09:00" } });
  const snoozedBreakdown = computePriority(snoozed, [], ctx);
  assert.equal(snoozedBreakdown.excluded, true);

  const expiredSnooze = baseItem({ metadata: { snoozedUntil: "2026-07-17T00:00:00+09:00" } });
  const expiredSnoozeBreakdown = computePriority(expiredSnooze, [], ctx);
  assert.equal(expiredSnoozeBreakdown.excluded, false, "Snooze 시각이 지났으면 다시 노출되어야 한다");
});

test("computePriority는 미완료 요구사항 점수를 15점에서 캡한다", () => {
  const now = new Date("2026-07-18T00:00:00+09:00");
  const manyRequirements = baseItem({ requirements: ["a", "b", "c", "d", "e"] });

  const breakdown = computePriority(manyRequirements, [], { now, profile: emptyProfile(), recentRecommendations: [] });
  assert.equal(breakdown.unmetRequirements, 15);
});

test("computePriority는 30분 이내 재추천을 제외하고, 30분~2시간은 패널티를 선형으로 줄인다", () => {
  const now = new Date("2026-07-18T12:00:00+09:00");
  const item = baseItem({ id: "ctx-repeat" });
  const profile = emptyProfile();

  const recentWithin30 = [{
    id: "rec-1", contextItemId: "ctx-repeat", action: "a", reason: "r",
    score: 50, evidenceIds: [], createdAt: "2026-07-18T11:45:00+09:00",
  }];
  const within30 = computePriority(item, [], { now, profile, recentRecommendations: recentWithin30 });
  assert.equal(within30.excluded, true);

  const recentAt60min = [{
    ...recentWithin30[0]!, createdAt: "2026-07-18T11:00:00+09:00",
  }];
  const at60min = computePriority(item, [], { now, profile, recentRecommendations: recentAt60min });
  assert.equal(at60min.excluded, false);
  assert.ok(at60min.recentNotificationPenalty > 0 && at60min.recentNotificationPenalty < 20);

  const recentOver2h = [{
    ...recentWithin30[0]!, createdAt: "2026-07-18T09:00:00+09:00",
  }];
  const over2h = computePriority(item, [], { now, profile, recentRecommendations: recentOver2h });
  assert.equal(over2h.recentNotificationPenalty, 0);
});

test("RuleBasedRecommendationEngine은 마감이 임박하고 요구사항이 남은 Task를 여유 있는 Opportunity보다 먼저 추천한다", async () => {
  const now = new Date("2026-07-18T09:00:00+09:00");
  const urgentTask = baseItem({
    id: "ctx-os-3",
    kind: "task",
    title: "운영체제 과제 3 보고서 작성",
    deadline: "2026-07-19T18:00:00+09:00",
    requirements: ["보고서", "소스코드"],
  });
  const relaxedOpportunity = baseItem({
    id: "ctx-hackathon",
    kind: "opportunity",
    title: "AI 해커톤 참가 신청서 초안",
    tags: ["opportunity"],
    deadline: "2026-07-25T18:00:00+09:00",
  });

  const engine = new RuleBasedRecommendationEngine();
  const recommendations = await engine.recommend([urgentTask, relaxedOpportunity], emptyProfile(), now);

  assert.equal(recommendations.length, 2);
  assert.equal(recommendations[0]?.contextItemId, "ctx-os-3");
  assert.equal(recommendations[1]?.contextItemId, "ctx-hackathon");
  assert.ok((recommendations[0]?.score ?? 0) > (recommendations[1]?.score ?? 0));
});

test("RuleBasedRecommendationEngine은 history Provider로 30분 내 재추천을 실제로 억제한다", async () => {
  const now = new Date("2026-07-18T12:00:00+09:00");
  const item = baseItem({ id: "ctx-suppressed" });
  const history = new InMemoryContextRepository();
  await history.saveRecommendations([{
    id: "rec-prev", contextItemId: "ctx-suppressed", action: "a", reason: "r",
    score: 50, evidenceIds: [], createdAt: "2026-07-18T11:50:00+09:00",
  }]);

  const engine = new RuleBasedRecommendationEngine({ history });
  const recommendations = await engine.recommend([item], emptyProfile(), now);

  assert.deepEqual(recommendations, []);
});

test("RuleBasedRecommendationEngine은 우선순위 상위 llmPhrasingLimit개까지만 LLM으로 문구를 생성한다", async () => {
  const now = new Date("2026-07-18T09:00:00+09:00");
  let callCount = 0;
  const provider: LLMProvider = {
    async completeJSON(request) {
      const value = { action: "LLM 문구", reason: "LLM 근거" };
      if (!request.validate(value)) throw new Error("unexpected");
      callCount += 1;
      return value;
    },
  };

  const items = [
    baseItem({ id: "ctx-soonest", title: "가장 급한 항목", deadline: "2026-07-18T18:00:00+09:00" }),
    baseItem({ id: "ctx-middle", title: "중간 항목", deadline: "2026-07-20T18:00:00+09:00" }),
    baseItem({ id: "ctx-latest", title: "가장 여유 있는 항목", deadline: "2026-07-25T18:00:00+09:00" }),
  ];

  const engine = new RuleBasedRecommendationEngine({ llmProvider: provider, llmPhrasingLimit: 2 });
  const recommendations = await engine.recommend(items, emptyProfile(), now);

  assert.equal(callCount, 2, "우선순위 상위 2개만 LLM을 호출해야 함");
  assert.equal(recommendations[0]?.contextItemId, "ctx-soonest");
  assert.equal(recommendations[1]?.contextItemId, "ctx-middle");
  assert.equal(recommendations[0]?.action, "LLM 문구");
  assert.equal(recommendations[1]?.action, "LLM 문구");

  // 순위가 가장 낮은 세 번째 항목은 LLM을 거치지 않고 템플릿을 그대로 써야 함.
  assert.equal(recommendations[2]?.contextItemId, "ctx-latest");
  assert.equal(recommendations[2]?.action, "가장 여유 있는 항목을(를) 확인하세요.");
  assert.equal(recommendations[2]?.reason, "마감: 2026-07-25T18:00:00+09:00");
});

test("RuleBasedRecommendationEngine의 llmPhrasingLimit 기본값은 5다", async () => {
  const now = new Date("2026-07-18T09:00:00+09:00");
  let callCount = 0;
  const provider: LLMProvider = {
    async completeJSON(request) {
      const value = { action: "LLM 문구", reason: "LLM 근거" };
      if (!request.validate(value)) throw new Error("unexpected");
      callCount += 1;
      return value;
    },
  };
  const items = Array.from({ length: 7 }, (_, index) => baseItem({
    id: `ctx-${index}`,
    deadline: `2026-07-${19 + index}T18:00:00+09:00`,
  }));

  const engine = new RuleBasedRecommendationEngine({ llmProvider: provider });
  await engine.recommend(items, emptyProfile(), now);

  assert.equal(callCount, 5);
});

test("RuleBasedRecommendationEngine은 일부 LLM 호출이 실패해도 다른 항목의 문구 생성을 유지한다", async () => {
  const now = new Date("2026-07-18T09:00:00+09:00");
  let callCount = 0;
  const provider: LLMProvider = {
    async completeJSON(request) {
      callCount += 1;
      if (callCount === 1) throw new Error("첫 번째 호출 실패");
      const value = { action: "LLM 문구", reason: "LLM 근거" };
      if (!request.validate(value)) throw new Error("unexpected");
      return value;
    },
  };
  const items = [
    baseItem({ id: "ctx-failed", title: "실패 항목", deadline: "2026-07-18T18:00:00+09:00" }),
    baseItem({ id: "ctx-succeeded", title: "성공 항목", deadline: "2026-07-20T18:00:00+09:00" }),
  ];

  const engine = new RuleBasedRecommendationEngine({ llmProvider: provider, llmPhrasingLimit: 2 });
  const recommendations = await engine.recommend(items, emptyProfile(), now);

  assert.equal(callCount, 2);
  assert.equal(recommendations[0]?.action, "실패 항목을(를) 확인하세요.");
  assert.equal(recommendations[1]?.action, "LLM 문구");
});

test("RuleBasedRecommendationEngine은 음수 llmPhrasingLimit을 0으로 처리한다", async () => {
  let callCount = 0;
  const provider: LLMProvider = {
    async completeJSON() {
      callCount += 1;
      throw new Error("호출되면 안 됨");
    },
  };
  const engine = new RuleBasedRecommendationEngine({ llmProvider: provider, llmPhrasingLimit: -1 });

  const recommendations = await engine.recommend(
    [baseItem({ title: "템플릿 항목" })],
    emptyProfile(),
    new Date("2026-07-18T09:00:00+09:00"),
  );

  assert.equal(callCount, 0);
  assert.equal(recommendations[0]?.action, "템플릿 항목을(를) 확인하세요.");
  assert.equal(recommendations[0]?.reason, "");
});

test("generateActionAndReason은 LLM이 유효한 응답을 주면 그대로 쓴다", async () => {
  const provider: LLMProvider = {
    async completeJSON(request) {
      const value = { action: "18시 전까지 보고서를 작성하세요.", reason: "마감이 내일입니다." };
      if (!request.validate(value)) throw new Error("unexpected");
      return value;
    },
  };
  const now = new Date("2026-07-18T00:00:00+09:00");
  const breakdown = computePriority(baseItem(), [], { now, profile: emptyProfile(), recentRecommendations: [] });

  const phrasing = await generateActionAndReason(baseItem(), breakdown, provider);
  assert.equal(phrasing.action, "18시 전까지 보고서를 작성하세요.");
});

test("generateActionAndReason은 Provider 실패 시 결정론적 템플릿으로 폴백한다", async () => {
  const provider: LLMProvider = {
    async completeJSON() {
      throw new Error("LLM 서버 다운");
    },
  };
  const now = new Date("2026-07-18T00:00:00+09:00");
  const item = baseItem({ title: "운영체제 과제 3", deadline: "2026-07-19T18:00:00+09:00" });
  const breakdown = computePriority(item, [], { now, profile: emptyProfile(), recentRecommendations: [] });

  const phrasing = await generateActionAndReason(item, breakdown, provider);
  assert.equal(phrasing.action, "운영체제 과제 3을(를) 확인하세요.");
  assert.equal(phrasing.reason, "마감: 2026-07-19T18:00:00+09:00");
});

// PR #13 리뷰(박도현님) 회귀 테스트: 하나의 RawItem에서 Fact가 여러 개 나오면
// (LLMFactExtractor가 실제로 배열을 반환하므로 흔한 경우), 뒤쪽 Fact가 방금 만든
// 항목과 자동 병합될 때 그 항목의 Evidence가 권위 비교 대상에서 누락돼 조건 없이
// 덮어쓰는 버그가 있었다. 수정 전엔 이 테스트가 실패했다(deadline이 두 번째 Fact
// 값으로 덮어써짐).
test("같은 RawItem에서 나온 여러 Fact가 병합될 때도 먼저 만든 Evidence를 권위 비교에서 빠뜨리지 않는다", async () => {
  const repository = new InMemoryContextRepository();
  const raw: RawItem = {
    id: "raw-lms-multi",
    sourceId: "lms-main",
    sourceType: "lms",
    externalId: "course-os-assignment-9",
    uri: "https://lms.example/courses/os/assignments/9",
    title: "운영체제 과제 9",
    content: "과제 9 관련 안내",
    contentHash: "hash-multi-1",
    observedAt: "2026-07-18T09:00:00+09:00",
    metadata: { course: "운영체제", official: true },
  };

  const pipeline = new ContextPipeline({
    repository,
    privacyGateway: new AllowlistPrivacyGateway(["lms"]),
    factExtractor: {
      async extract(rawItem) {
        return [
          {
            id: "fact-multi-a",
            rawItemId: rawItem.id,
            kind: "task",
            subject: "운영체제 과제 9",
            value: "제출",
            eventTime: "2026-07-22T18:00:00+09:00",
            confidence: 0.9,
            evidenceText: rawItem.content,
          },
          {
            id: "fact-multi-b",
            rawItemId: rawItem.id,
            kind: "task",
            subject: "운영체제 과제 9",
            value: "제출",
            eventTime: "2026-07-23T09:00:00+09:00",
            confidence: 0.9,
            evidenceText: rawItem.content,
          },
        ];
      },
    },
    contextResolver: new DeterministicContextResolver(),
  });

  await pipeline.sync(new FixtureCollector("lms-main", "lms", [raw]));

  const tasks = await repository.listContextItems("task");
  assert.equal(tasks.length, 1, "두 Fact는 같은 항목으로 자동 병합돼야 한다(점수 70점 이상)");
  assert.equal(
    tasks[0]?.deadline,
    "2026-07-22T18:00:00+09:00",
    "같은 rawItem이라 두 Evidence의 권위·관찰 시각이 동률이므로 먼저 만든 값을 유지해야 한다",
  );
  assert.equal(tasks[0]?.evidenceIds.length, 2);
});

// PR #13 리뷰(김도연님) 회귀 테스트 1: resolveConflict의 동률 비교는 observedAt
// 문자열이 아니라 실제 시각(Date.parse)으로 해야 한다. UTC offset이 다르면 문자열
// 순서와 실제 시간 순서가 어긋나기 때문이다.
test("resolveConflict는 권위가 같을 때 UTC offset이 달라도 실제로 최신인 Evidence를 고른다", () => {
  const older: Evidence = {
    id: "ev-older",
    rawItemId: "r1",
    sourceType: "school-site",
    location: "u1",
    quote: "q",
    observedAt: "2026-07-18T10:00:00+09:00", // 실제로는 01:00Z
    authority: "official",
  };
  const newer: Evidence = {
    id: "ev-newer",
    rawItemId: "r2",
    sourceType: "calendar",
    location: "u2",
    quote: "q",
    observedAt: "2026-07-18T02:00:00+00:00", // 실제로는 02:00Z — older보다 1시간 최신
    authority: "official",
  };

  // 문자열 비교였다면 "10:00..." >= "02:00..."이라 older를 골라 틀렸을 케이스.
  assert.equal(resolveConflict(older, newer).id, "ev-newer");
  assert.equal(resolveConflict(newer, older).id, "ev-newer");
});

test("resolveConflict는 파싱 불가능한 observedAt보다 유효한 시각을 가진 Evidence를 우선한다", () => {
  const valid: Evidence = {
    id: "ev-valid", rawItemId: "r1", sourceType: "lms", location: "u", quote: "q",
    observedAt: "2026-07-18T09:00:00+09:00", authority: "user",
  };
  const invalid: Evidence = {
    id: "ev-invalid", rawItemId: "r2", sourceType: "lms", location: "u", quote: "q",
    observedAt: "not-a-real-date", authority: "user",
  };

  assert.equal(resolveConflict(valid, invalid).id, "ev-valid");
  assert.equal(resolveConflict(invalid, valid).id, "ev-valid");
});

// PR #13 리뷰(김도연님) 회귀 테스트 2: 카드에 마감과 무관한 고권위 Evidence가 있어도,
// 마감 갱신은 "마감을 실제로 뒷받침하는 근거"끼리만 비교해야 한다. 무관한 공식 근거가
// 낮은 권위의 정당한 최신 마감 변경을 영구히 막으면 안 된다.
test("마감과 무관한 고권위 Evidence가 낮은 권위의 최신 마감 변경을 차단하지 않는다", async () => {
  const repository = new InMemoryContextRepository();
  const pipeline = new ContextPipeline({
    repository,
    privacyGateway: new AllowlistPrivacyGateway(["screen", "lms"]),
    factExtractor: {
      async extract(rawItem) {
        if (rawItem.id === "raw-screen-1") {
          // 낮은 권위(observation) 출처가 최초 마감(7/21)을 관찰
          return [{
            id: "fact-screen-1", rawItemId: rawItem.id, kind: "task",
            subject: "운영체제 기말 과제", value: "제출",
            eventTime: "2026-07-21T18:00:00+09:00", confidence: 0.9, evidenceText: rawItem.content,
          }];
        }
        if (rawItem.id === "raw-lms-req") {
          // 공식(official) 출처지만 마감이 아니라 요구사항만 뒷받침. eventTime을 기존 마감과
          // 동일하게 줘서 병합 점수는 확보하되 마감값 자체는 바뀌지 않게 한다.
          return [{
            id: "fact-lms-req", rawItemId: rawItem.id, kind: "requirement",
            subject: "운영체제 기말 과제", value: "보고서 PDF 제출",
            eventTime: "2026-07-21T18:00:00+09:00", confidence: 0.9, evidenceText: rawItem.content,
          }];
        }
        // 다시 낮은 권위(observation) 출처가 더 최신에 마감 연장(7/23)을 관찰
        return [{
          id: "fact-screen-2", rawItemId: rawItem.id, kind: "task",
          subject: "운영체제 기말 과제", value: "제출",
          eventTime: "2026-07-23T18:00:00+09:00", confidence: 0.9, evidenceText: rawItem.content,
        }];
      },
    },
    contextResolver: new DeterministicContextResolver(),
  });

  // sync 1: 낮은 권위가 마감 7/21을 세팅 (deadlineEvidenceId = observation 근거)
  await pipeline.sync(new FixtureCollector("screen", "screen", [{
    id: "raw-screen-1", sourceId: "screen", sourceType: "screen",
    uri: "screen://1", title: "운영체제 기말 과제", content: "기말 과제 마감 7월 21일",
    contentHash: "h-s1", observedAt: "2026-07-18T09:00:00+09:00",
    metadata: { course: "운영체제" },
  }]));

  // sync 2: 공식 근거가 요구사항만 추가(마감은 동일값이라 안 바뀜). 카드에 고권위 근거가 섞인다.
  await pipeline.sync(new FixtureCollector("lms-main", "lms", [{
    id: "raw-lms-req", sourceId: "lms-main", sourceType: "lms",
    uri: "https://lms.example/os/final", title: "운영체제 기말 과제", content: "보고서 PDF 제출 필수",
    contentHash: "h-req", observedAt: "2026-07-19T09:00:00+09:00",
    metadata: { course: "운영체제", official: true },
  }]));

  const afterOfficial = await repository.listContextItems("task");
  assert.equal(afterOfficial.length, 1, "세 Fact가 하나의 Task로 병합돼야 한다");
  assert.equal(afterOfficial[0]?.deadline, "2026-07-21T18:00:00+09:00");

  // sync 3: 낮은 권위지만 더 최신 관찰이 마감을 7/23으로 연장. 무관한 공식 근거에 막히면 안 된다.
  await pipeline.sync(new FixtureCollector("screen", "screen", [{
    id: "raw-screen-2", sourceId: "screen", sourceType: "screen",
    uri: "screen://2", title: "운영체제 기말 과제", content: "마감이 7월 23일로 연장됨",
    contentHash: "h-s2", observedAt: "2026-07-20T09:00:00+09:00",
    metadata: { course: "운영체제" },
  }]));

  const finalTasks = await repository.listContextItems("task");
  assert.equal(finalTasks.length, 1);
  assert.equal(
    finalTasks[0]?.deadline,
    "2026-07-23T18:00:00+09:00",
    "마감을 뒷받침하는 근거끼리(observation vs observation, 최신 우선) 비교해 갱신돼야 한다",
  );
});

test("resolveWithEvidence는 주입된 observedAt을 ContextItem·History 시각에 쓴다(시스템 시간 비의존)", async () => {
  const resolver = new DeterministicContextResolver();
  const injectedNow = "2026-07-18T09:00:00+09:00";
  const rawItem: RawItem = {
    id: "raw-time-1", sourceId: "lms", sourceType: "lms", uri: "u",
    title: "과제", content: "과제 마감", contentHash: "h", observedAt: injectedNow, metadata: {},
  };
  const fact: Fact = {
    id: "fact-time-1", rawItemId: "raw-time-1", kind: "task", subject: "과제",
    value: "제출", eventTime: "2026-07-22T18:00:00+09:00", confidence: 0.9, evidenceText: "과제 마감",
  };

  const outcome = await resolver.resolveWithEvidence([fact], [], {
    rawItemsById: new Map([["raw-time-1", rawItem]]),
    existingEvidence: [],
    observedAt: injectedNow,
  });

  assert.equal(outcome.createdItems[0]?.createdAt, injectedNow);
  assert.equal(outcome.createdItems[0]?.updatedAt, injectedNow);
  assert.equal(outcome.history[0]?.changedAt, injectedNow, "변경 이력 changedAt이 RawItem observedAt과 같아야 append-only 재분석이 멱등이 된다");
});

// 김도연님 리뷰 P2: 기준 시각이 관찰 시각이라, 뒤늦게 수집된 오래된 공지가 기존
// Context에 병합되면 updatedAt이 과거로 돌아갈 수 있다. "마지막으로 갱신된 시각"은
// 단조 증가해야 최근 갱신 기준 조회가 어긋나지 않는다.
test("오래된 관찰이 병합돼도 ContextItem.updatedAt은 과거로 돌아가지 않는다", async () => {
  const resolver = new DeterministicContextResolver();
  const laterUpdate = "2026-07-18T09:00:00+09:00";
  const earlierObservation = "2026-07-10T09:00:00+09:00";

  const existingItem: ContextItem = {
    id: "ctx-fact-merge-base", kind: "task", title: "운영체제 과제 3",
    status: "todo", deadline: "2026-07-22T18:00:00+09:00",
    requirements: [], tags: ["task", "운영체제"], priority: 0, confidence: 0.9,
    evidenceIds: [], metadata: { rawItemId: "raw-merge-base", course: "운영체제" },
    createdAt: laterUpdate, updatedAt: laterUpdate,
  };
  const oldRawItem: RawItem = {
    id: "raw-old", sourceId: "lms", sourceType: "lms", uri: "u-old",
    title: "운영체제 과제 3", content: "운영체제 과제 3 안내", contentHash: "h-old",
    observedAt: earlierObservation, metadata: { course: "운영체제" },
  };
  const oldFact: Fact = {
    id: "fact-old", rawItemId: "raw-old", kind: "task", subject: "운영체제 과제 3",
    value: "제출", eventTime: "2026-07-22T18:00:00+09:00", confidence: 0.9,
    evidenceText: "운영체제 과제 3 안내",
  };

  const outcome = await resolver.resolveWithEvidence([oldFact], [existingItem], {
    rawItemsById: new Map([["raw-old", oldRawItem]]),
    existingEvidence: [],
    observedAt: earlierObservation,
  });

  const merged = outcome.updatedItems[0];
  assert.ok(merged, "같은 과목·같은 제목이면 병합돼야 한다");
  assert.equal(merged.updatedAt, laterUpdate, "더 늦은 기존 updatedAt이 유지돼야 한다");
  assert.ok(
    Date.parse(merged.updatedAt) >= Date.parse(merged.createdAt),
    "updatedAt이 createdAt보다 앞설 수 없다",
  );
  assert.equal(
    outcome.history[0]?.changedAt,
    earlierObservation,
    "변경 이력은 그 변경을 일으킨 관찰 시각을 그대로 남겨야 재분석이 멱등이 된다",
  );
});

// 관찰 시각은 필수 필드라 호출부가 생략할 수 없다. RawItem이
// 없는 좁은 resolve() 경로만 기준 시각을 만들 데가 없으므로 시계를 주입받는다.
test("좁은 resolve() 경로는 주입된 시계를 쓴다(new Date() 직접 호출 없음)", async () => {
  const fixed = new Date("2026-07-18T09:00:00+09:00");
  const resolver = new DeterministicContextResolver(() => fixed);
  const fact: Fact = {
    id: "fact-clock", rawItemId: "raw-clock", kind: "task", subject: "과제",
    value: "제출", confidence: 0.9, evidenceText: "과제 마감",
  };

  const items = await resolver.resolve([fact], []);

  assert.equal(items[0]?.createdAt, fixed.toISOString());
  assert.equal(items[0]?.updatedAt, fixed.toISOString());
});

test("LLMFactExtractor는 metadata.canonicalTitle을 주제 Fact 제목보다 우선한다", async () => {
  const raw: RawItem = {
    id: "raw-canon", sourceId: "school-email", sourceType: "school-email", uri: "u",
    title: "[학생지원팀] AI 해커톤", content: "AI 해커톤 안내",
    contentHash: "h", observedAt: "2026-07-18T00:00:00+09:00",
    metadata: { canonicalTitle: "대학생 AI 해커톤" },
  };
  const provider: LLMProvider = {
    async completeJSON<T>(request: LLMJSONRequest<T>): Promise<T> {
      const value = { facts: [
        { kind: "opportunity", subject: "[학생지원팀] AI 해커톤", value: "모집", confidence: 0.9, evidenceText: "AI 해커톤 안내" },
        { kind: "requirement", subject: "보고서 제출", value: "PDF", confidence: 0.9, evidenceText: "AI 해커톤 안내" },
      ] };
      if (!request.validate(value)) throw new Error("invalid");
      return value;
    },
  };
  const facts = await new LLMFactExtractor(provider).extract(raw);

  const opp = facts.find((f) => f.kind === "opportunity");
  const req = facts.find((f) => f.kind === "requirement");
  assert.equal(opp?.subject, "대학생 AI 해커톤", "주제 Fact 제목은 canonicalTitle로 통일된다");
  assert.equal(req?.subject, "보고서 제출", "requirement 같은 세부 Fact는 그대로 둔다");
});

test("LLMFactExtractor는 metadata.dueAt을 마감성 Fact의 LLM 추출 마감보다 우선한다", async () => {
  const raw: RawItem = {
    id: "raw-due", sourceId: "lms", sourceType: "lms", uri: "u",
    title: "과제 3", content: "과제 마감 관련",
    contentHash: "h", observedAt: "2026-07-18T00:00:00+09:00",
    metadata: { course: "운영체제", dueAt: "2026-07-23T18:00:00+09:00" },
  };
  const provider: LLMProvider = {
    async completeJSON<T>(request: LLMJSONRequest<T>): Promise<T> {
      const value = { facts: [
        { kind: "task", subject: "과제 3", value: "제출", eventTime: "2026-07-21T18:00:00+09:00", confidence: 0.9, evidenceText: "과제 마감 관련" },
      ] };
      if (!request.validate(value)) throw new Error("invalid");
      return value;
    },
  };
  const facts = await new LLMFactExtractor(provider).extract(raw);
  assert.equal(facts[0]?.eventTime, "2026-07-23T18:00:00+09:00", "구조화된 dueAt이 LLM이 뽑은 마감보다 우선한다");
});

// 김도연님 리뷰 P1: LLM의 eventTime은 Schema의 format: "date-time" 검증을 거치지만
// metadata.dueAt은 Collector가 HTML 속성값을 그대로 옮긴 신뢰할 수 없는 외부 입력이다.
function lmsRawItemWithDueAt(dueAt: unknown): RawItem {
  return {
    id: "raw-due-invalid", sourceId: "lms", sourceType: "lms", uri: "u",
    title: "과제 3", content: "과제 마감 관련",
    contentHash: "h", observedAt: "2026-07-18T00:00:00+09:00",
    metadata: { course: "운영체제", dueAt },
  };
}

function taskFactProvider(eventTime: string): LLMProvider {
  return {
    async completeJSON<T>(request: LLMJSONRequest<T>): Promise<T> {
      const value = { facts: [
        { kind: "task", subject: "과제 3", value: "제출", eventTime, confidence: 0.9, evidenceText: "과제 마감 관련" },
      ] };
      if (!request.validate(value)) throw new Error("invalid");
      return value;
    },
  };
}

test("LLMFactExtractor는 ISO date-time이 아닌 metadata.dueAt을 무시하고 LLM 값으로 폴백한다", async () => {
  const llmEventTime = "2026-07-21T18:00:00+09:00";
  const invalidValues = [
    "tomorrow", "invalid", 20260723, null,
    "2026-07-23",             // 시각 없음
    "2026-07-23T18:00:00",    // 오프셋 없음 — 실행 환경 타임존에 따라 달라진다
    "2026-13-01T18:00:00+09:00", "2026-07-23T25:00:00+09:00", // 범위 초과
    // Date.parse가 조용히 다음 달로 굴리는 값들(김도연님 리뷰 P1).
    // 2026-02-30 → 3월 2일, 2026-02-29(평년) → 3월 1일, 2026-04-31 → 5월 1일.
    "2026-02-30T18:00:00+09:00", "2026-02-29T18:00:00+09:00", "2026-04-31T18:00:00+09:00",
  ];

  for (const dueAt of invalidValues) {
    const facts = await new LLMFactExtractor(taskFactProvider(llmEventTime))
      .extract(lmsRawItemWithDueAt(dueAt));
    assert.equal(
      facts[0]?.eventTime,
      llmEventTime,
      `유효하지 않은 dueAt(${JSON.stringify(dueAt)})은 마감으로 쓰이면 안 된다`,
    );
  }
});

test("LLMFactExtractor는 윤년의 2월 29일 같은 실제 날짜는 dueAt으로 받아들인다", async () => {
  const validValues = [
    "2024-02-29T18:00:00+09:00", // 윤년
    "2026-12-31T23:59:59+09:00",
    "2026-07-23T09:00:00Z",
    "2026-07-23T09:00:00.500Z",
  ];

  for (const dueAt of validValues) {
    const facts = await new LLMFactExtractor(taskFactProvider("2026-07-21T18:00:00+09:00"))
      .extract(lmsRawItemWithDueAt(dueAt));
    assert.equal(facts[0]?.eventTime, dueAt, `유효한 dueAt(${dueAt})은 그대로 쓰여야 한다`);
  }
});

// 김도연님 리뷰 P1: 구조화 값으로 덮어쓴 마감·제목을 원본 인용문만으로는 확인할 수 없다.
// 구조화 값도 같은 RawItem을 파싱해 얻은 원본 신호이므로 Evidence에 함께 보존한다.
test("구조화 값으로 대체된 마감·제목은 Evidence quote에 출처와 함께 보존된다", () => {
  const rawItem: RawItem = {
    id: "raw-structured", sourceId: "lms", sourceType: "lms", uri: "https://lms.example/a/3",
    title: "[운영체제] 과제 3", content: "과제 마감 관련",
    contentHash: "h", observedAt: "2026-07-18T00:00:00+09:00",
    metadata: { canonicalTitle: "운영체제 과제 3", dueAt: "2026-07-23T18:00:00+09:00" },
  };
  const fact: Fact = {
    id: "fact-structured", rawItemId: rawItem.id, kind: "task",
    subject: "운영체제 과제 3", value: "제출", eventTime: "2026-07-23T18:00:00+09:00",
    confidence: 0.9, evidenceText: "과제 마감 관련",
  };

  const evidence = buildEvidence(fact, rawItem);

  assert.match(evidence.quote, /과제 마감 관련/, "LLM이 따온 원문 인용은 그대로 남는다");
  assert.match(evidence.quote, /\[구조화 필드\] dueAt: 2026-07-23T18:00:00\+09:00/);
  assert.match(evidence.quote, /\[구조화 필드\] canonicalTitle: 운영체제 과제 3/);
});

test("구조화 값을 쓰지 않은 Fact의 Evidence quote는 원문 인용 그대로다", () => {
  const rawItem: RawItem = {
    id: "raw-plain", sourceId: "school-site", sourceType: "school-site", uri: "u",
    title: "공지", content: "7월 25일까지 신청하세요.",
    contentHash: "h", observedAt: "2026-07-18T00:00:00+09:00", metadata: {},
  };
  const fact: Fact = {
    id: "fact-plain", rawItemId: rawItem.id, kind: "opportunity",
    subject: "신청", value: "모집", confidence: 0.9, evidenceText: "7월 25일까지 신청하세요.",
  };

  assert.equal(buildEvidence(fact, rawItem).quote, "7월 25일까지 신청하세요.");
});
