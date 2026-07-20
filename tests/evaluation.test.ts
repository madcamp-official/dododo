import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { FixtureCollector } from "../packages/collectors/src/index.ts";
import { ContextPipeline, DeterministicContextResolver } from "../packages/context-engine/src/index.ts";
import {
  evaluateExtraction,
  evaluateMergeAccuracy,
} from "../packages/evaluation/src/index.ts";
import type { ExpectedContextItem, GroundTruthCase } from "../packages/evaluation/src/index.ts";
import { AllowlistPrivacyGateway } from "../packages/privacy/src/index.ts";
import { InMemoryContextRepository } from "../packages/storage/src/index.ts";
import type { ContextItem, Evidence, Fact, RawItem } from "../packages/shared/src/index.ts";

function contextItem(overrides: Partial<ContextItem>): ContextItem {
  return {
    id: "ctx-x",
    kind: "opportunity",
    title: "제목",
    status: "new",
    requirements: [],
    tags: [],
    priority: 0,
    confidence: 0.9,
    evidenceIds: [],
    metadata: {},
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

const expectedHackathon: ExpectedContextItem = {
  title: "대학생 AI 해커톤",
  kind: "opportunity",
  evidenceCount: 2,
};

test("evaluateExtraction은 완벽히 일치하면 F1 1.0을 낸다", () => {
  const actual = [contextItem({
    title: "대학생 AI 해커톤 참가자 모집",
    kind: "opportunity",
    evidenceIds: ["ev-site", "ev-email"],
  })];
  const result = evaluateExtraction([expectedHackathon], actual);

  assert.equal(result.truePositive, 1);
  assert.equal(result.metrics.f1, 1);
  assert.deepEqual(result.failures, []);
});

test("evaluateExtraction은 누락·과잉·오분류를 구분해 센다", () => {
  const expected: ExpectedContextItem[] = [
    { title: "대학생 AI 해커톤", kind: "opportunity", evidenceCount: 1 },
    { title: "운영체제 과제 3", kind: "task", evidenceCount: 1 },
  ];
  const actual = [
    contextItem({ title: "운영체제 과제 3", kind: "event" }), // 오분류(task여야 함)
    contextItem({ title: "동아리 회식", kind: "event" }), // 기대에 없음(과잉)
  ];

  const result = evaluateExtraction(expected, actual);
  assert.equal(result.truePositive, 0);
  assert.equal(result.falseNegative, 2, "해커톤 누락 + 과제 오분류");
  assert.equal(result.falsePositive, 2, "과제 오분류 + 동아리 회식 과잉");
  assert.ok(result.failures.some((f) => f.type === "missing"));
  assert.ok(result.failures.some((f) => f.type === "wrong_kind"));
  assert.ok(result.failures.some((f) => f.type === "unexpected"));
});

test("evaluateExtraction은 kind 오분류를 FP와 FN에 모두 반영한다", () => {
  const expected: ExpectedContextItem[] = [
    { title: "운영체제 과제", kind: "task", evidenceCount: 1 },
    { title: "AI 해커톤", kind: "opportunity", evidenceCount: 1 },
  ];
  const actual = [
    contextItem({ title: "운영체제 과제", kind: "event" }),
    contextItem({ title: "AI 해커톤", kind: "opportunity", evidenceIds: ["ev-ai"] }),
  ];

  const result = evaluateExtraction(expected, actual);

  assert.equal(result.truePositive, 1);
  assert.equal(result.falsePositive, 1);
  assert.equal(result.falseNegative, 1);
  assert.equal(result.metrics.precision, 0.5);
  assert.equal(result.metrics.recall, 0.5);
  assert.equal(result.metrics.f1, 0.5);
});

test("evaluateExtraction은 deadline과 evidenceCount가 틀리면 TP로 인정하지 않는다", () => {
  const expected: ExpectedContextItem[] = [{
    title: "운영체제 과제 3",
    kind: "task",
    deadline: "2026-07-22T23:59:00+09:00",
    evidenceCount: 2,
  }];
  const actual = [contextItem({
    title: "운영체제 과제 3",
    kind: "task",
    deadline: "2099-01-01T00:00:00+09:00",
    evidenceIds: [],
  })];

  const result = evaluateExtraction(expected, actual);

  assert.equal(result.truePositive, 0);
  assert.equal(result.falsePositive, 1, "필드가 여러 개 틀려도 실제 항목은 한 번만 센다");
  assert.equal(result.falseNegative, 1, "필드가 여러 개 틀려도 기대 항목은 한 번만 센다");
  assert.equal(result.metrics.f1, 0);
  assert.ok(result.failures.some((failure) => failure.type === "wrong_deadline"));
  assert.ok(result.failures.some((failure) => failure.type === "wrong_evidence_count"));
});

test("evaluateExtraction 제목 매칭은 배열 순서와 무관하게 정확한 kind·제목을 우선한다", () => {
  const expected: ExpectedContextItem[] = [
    { title: "AI", kind: "task", evidenceCount: 1 },
    { title: "AI 해커톤", kind: "opportunity", evidenceCount: 1 },
  ];
  const actual = [
    contextItem({ title: "AI 해커톤", kind: "opportunity", evidenceIds: ["ev-hackathon"] }),
    contextItem({ title: "AI", kind: "task", evidenceIds: ["ev-task"] }),
  ];

  for (const expectedOrder of [expected, [...expected].reverse()]) {
    for (const actualOrder of [actual, [...actual].reverse()]) {
      const result = evaluateExtraction(expectedOrder, actualOrder);
      assert.equal(result.truePositive, 2);
      assert.equal(result.metrics.f1, 1);
      assert.deepEqual(result.failures, []);
    }
  }
});

test("evaluateMergeAccuracy는 기대한 두 출처가 한 항목에 모이면 1.0을 낸다", () => {
  const items = [contextItem({ id: "ctx-1", evidenceIds: ["ev-a", "ev-b"] })];
  const evidence: Evidence[] = [
    { id: "ev-a", rawItemId: "raw-site", sourceType: "school-site", location: "u", quote: "q", observedAt: "t", authority: "official" },
    { id: "ev-b", rawItemId: "raw-email", sourceType: "school-email", location: "u", quote: "q", observedAt: "t", authority: "official" },
  ];

  const result = evaluateMergeAccuracy([["raw-site", "raw-email"]], items, evidence);
  assert.equal(result.accuracy, 1);
  assert.equal(result.correctMerges, 1);
  assert.equal(result.falseMerges, 0);
  assert.equal(result.duplicateAssignments, 0);
});

test("evaluateMergeAccuracy는 병합돼야 할 것이 분리되면 not_merged로 감점한다", () => {
  const items = [
    contextItem({ id: "ctx-1", evidenceIds: ["ev-a"] }),
    contextItem({ id: "ctx-2", evidenceIds: ["ev-b"] }),
  ];
  const evidence: Evidence[] = [
    { id: "ev-a", rawItemId: "raw-site", sourceType: "school-site", location: "u", quote: "q", observedAt: "t", authority: "official" },
    { id: "ev-b", rawItemId: "raw-email", sourceType: "school-email", location: "u", quote: "q", observedAt: "t", authority: "official" },
  ];

  const result = evaluateMergeAccuracy([["raw-site", "raw-email"]], items, evidence);
  assert.equal(result.accuracy, 0);
  assert.ok(result.failures.some((f) => f.type === "not_merged"));
});

test("evaluateMergeAccuracy는 예상 밖 병합(false merge)을 감지한다", () => {
  const items = [contextItem({ id: "ctx-1", evidenceIds: ["ev-a", "ev-b"] })];
  const evidence: Evidence[] = [
    { id: "ev-a", rawItemId: "raw-x", sourceType: "lms", location: "u", quote: "q", observedAt: "t", authority: "official" },
    { id: "ev-b", rawItemId: "raw-y", sourceType: "lms", location: "u", quote: "q", observedAt: "t", authority: "official" },
  ];

  // 병합을 기대하지 않았는데 한 항목에 모임 → false merge
  const result = evaluateMergeAccuracy([], items, evidence);
  assert.equal(result.falseMerges, 1);
  assert.ok(result.failures.some((f) => f.type === "false_merge"));
});

test("evaluateMergeAccuracy는 하나의 RawItem이 여러 ContextItem에 연결되면 순서와 무관하게 실패한다", () => {
  const items = [
    contextItem({ id: "ctx-duplicate", evidenceIds: ["ev-a"] }),
    contextItem({ id: "ctx-merged", evidenceIds: ["ev-a", "ev-b"] }),
  ];
  const evidence: Evidence[] = [
    { id: "ev-a", rawItemId: "raw-a", sourceType: "school-site", location: "u", quote: "q", observedAt: "t", authority: "official" },
    { id: "ev-b", rawItemId: "raw-b", sourceType: "school-email", location: "u", quote: "q", observedAt: "t", authority: "official" },
  ];

  for (const itemOrder of [items, [...items].reverse()]) {
    const result = evaluateMergeAccuracy([["raw-a", "raw-b"]], itemOrder, evidence);
    assert.equal(result.correctMerges, 0);
    assert.equal(result.duplicateAssignments, 1);
    assert.equal(result.accuracy, 0);
    assert.ok(result.failures.some((failure) => failure.type === "duplicate_context"));
  }
});

// Ground Truth fixture를 실제 파이프라인에 태워 채점하는 end-to-end 벤치마크.
test("Ground Truth: 사이트+이메일 공모전이 파이프라인을 거쳐 병합되고 벤치마크가 F1·병합정확도를 산출한다", async () => {
  const groundTruth = JSON.parse(
    await readFile("fixtures/ground-truth/ai-hackathon.expected.json", "utf8"),
  ) as GroundTruthCase;
  const siteRaw = await loadRawItem("fixtures/school-site/ai-hackathon.json");
  const emailRaw = await loadRawItem("fixtures/school-email/ai-hackathon-email.json");

  const repository = new InMemoryContextRepository();
  const pipeline = new ContextPipeline({
    repository,
    privacyGateway: new AllowlistPrivacyGateway(["school-site", "school-email"]),
    factExtractor: { extract: hackathonExtractor },
    contextResolver: new DeterministicContextResolver(),
  });

  await pipeline.sync(new FixtureCollector("school-site-main", "school-site", [siteRaw]));
  await pipeline.sync(new FixtureCollector("school-email-main", "school-email", [emailRaw]));

  const items = await repository.listContextItems();
  const evidence = await pipeline.evidenceStore.listEvidence(items.flatMap((item) => item.evidenceIds));

  const extraction = evaluateExtraction(groundTruth.expectedContextItems, items);
  const merge = evaluateMergeAccuracy(groundTruth.expectedMerges, items, evidence);

  assert.equal(extraction.metrics.f1, 1, "기대한 Opportunity 하나가 정확히 추출돼야 한다");
  assert.equal(merge.accuracy, 1, "사이트+이메일이 하나로 병합돼야 한다");
  assert.equal(merge.falseMerges, 0);
});

test("Ground Truth: LMS 과제 공지가 마감 있는 Task로 추출되고 벤치마크가 F1을 산출한다", async () => {
  const groundTruth = JSON.parse(
    await readFile("fixtures/ground-truth/os-assignment.expected.json", "utf8"),
  ) as GroundTruthCase;
  const lmsRaw = await loadRawItem("fixtures/lms/os-assignment.json");

  const repository = new InMemoryContextRepository();
  const pipeline = new ContextPipeline({
    repository,
    privacyGateway: new AllowlistPrivacyGateway(["lms"]),
    factExtractor: {
      async extract(rawItem) {
        return [{
          id: `fact-${rawItem.id}`,
          rawItemId: rawItem.id,
          kind: "task",
          subject: "운영체제 과제 3",
          value: "보고서 PDF와 소스코드 ZIP 제출",
          eventTime: "2026-07-22T23:59:00+09:00",
          confidence: 0.9,
          evidenceText: rawItem.content,
        }];
      },
    },
    contextResolver: new DeterministicContextResolver(),
  });

  await pipeline.sync(new FixtureCollector("lms-main", "lms", [lmsRaw]));

  const items = await repository.listContextItems();
  const extraction = evaluateExtraction(groundTruth.expectedContextItems, items);

  assert.equal(extraction.metrics.f1, 1);
  assert.equal(items[0]?.deadline, groundTruth.expectedContextItems[0]?.deadline);
});

async function loadRawItem(path: string): Promise<RawItem> {
  return JSON.parse(await readFile(path, "utf8")) as RawItem;
}

async function hackathonExtractor(rawItem: RawItem): Promise<Fact[]> {
  return [{
    id: `fact-${rawItem.id}`,
    rawItemId: rawItem.id,
    kind: "opportunity",
    subject: "대학생 AI 해커톤",
    value: "참가자 모집",
    eventTime: "2026-07-25T18:00:00+09:00",
    confidence: 0.9,
    evidenceText: rawItem.content.includes("2026년 7월 25일")
      ? "신청 마감은 2026년 7월 25일 18시입니다."
      : rawItem.content,
  }];
}
