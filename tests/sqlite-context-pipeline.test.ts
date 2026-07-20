import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { syncIncrementally } from "../apps/cli/src/runtime/incrementalSync.ts";
import { FixtureCollector } from "../packages/collectors/src/index.ts";
import { ContextPipeline, DeterministicContextResolver } from "../packages/context-engine/src/index.ts";
import { AllowlistPrivacyGateway } from "../packages/privacy/src/index.ts";
import type {
  Collector,
  Fact,
  FactExtractor,
  RawItem,
  SourceType,
} from "../packages/shared/src/index.ts";
import {
  openContextDatabase,
  SQLiteContextRepository,
  SQLiteRawItemRepository,
} from "../packages/storage/src/index.ts";

class MetadataFactExtractor implements FactExtractor {
  callCount = 0;

  async extract(rawItem: RawItem): Promise<Fact[]> {
    this.callCount += 1;
    const deadline = typeof rawItem.metadata.deadline === "string"
      ? rawItem.metadata.deadline
      : undefined;
    return [{
      id: `fact-${rawItem.id}-${rawItem.contentHash}`,
      rawItemId: rawItem.id,
      kind: rawItem.sourceType === "lms" ? "task" : "opportunity",
      subject: rawItem.title ?? "제목 없음",
      value: rawItem.content,
      eventTime: deadline,
      confidence: 0.95,
      evidenceText: rawItem.content,
    }];
  }
}

function item(overrides: Partial<RawItem> = {}): RawItem {
  return {
    id: "raw-lms-1",
    sourceId: "lms-main",
    sourceType: "lms",
    externalId: "assignment-1",
    uri: "https://lms.example/assignments/1",
    title: "운영체제 과제 1",
    content: "운영체제 과제 1을 제출합니다.",
    contentHash: "hash-v1",
    observedAt: "2026-07-20T09:00:00+09:00",
    metadata: {
      course: "운영체제",
      deadline: "2026-07-25T23:59:00+09:00",
      official: true,
    },
    ...overrides,
  };
}

function collector(rawItem: RawItem): Collector {
  return new FixtureCollector(rawItem.sourceId, rawItem.sourceType, [rawItem]);
}

function createPipeline(
  repository: SQLiteContextRepository,
  extractor: FactExtractor,
  allowedSources: SourceType[] = ["school-site", "school-email", "lms"],
): ContextPipeline {
  return new ContextPipeline({
    repository,
    privacyGateway: new AllowlistPrivacyGateway(allowedSources),
    factExtractor: extractor,
    contextResolver: new DeterministicContextResolver(),
  });
}

test("Fixture에서 Pipeline을 거친 Context와 Evidence가 SQLite 재시작 후 유지된다", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dododo-pipeline-restart-"));
  const path = join(directory, "context.db");
  try {
    const firstDatabase = openContextDatabase(path);
    const firstRepository = new SQLiteContextRepository(firstDatabase);
    const firstRawItems = new SQLiteRawItemRepository(firstDatabase);
    const pipeline = createPipeline(firstRepository, new MetadataFactExtractor());
    const rawItem = item();

    const result = await syncIncrementally(collector(rawItem), pipeline, firstRawItems);
    assert.deepEqual(result.errors, []);
    assert.equal(result.created, 1);
    firstDatabase.close();

    const secondDatabase = openContextDatabase(path);
    try {
      const repository = new SQLiteContextRepository(secondDatabase);
      const tasks = await repository.listContextItems("task");
      assert.equal(tasks.length, 1);
      assert.equal(tasks[0]?.deadline, "2026-07-25T23:59:00+09:00");
      assert.equal((await repository.listFactsByRawItemId(rawItem.id)).length, 1);
      assert.equal((await repository.listEvidenceByContextItemId(tasks[0]!.id)).length, 1);
      assert.equal((await repository.listContextHistory(tasks[0]!.id)).length, 1);
    } finally {
      secondDatabase.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("동일 Fixture 재동기화는 Pipeline 재분석과 중복 저장을 건너뛴다", async () => {
  const database = openContextDatabase();
  try {
    const repository = new SQLiteContextRepository(database);
    const rawItems = new SQLiteRawItemRepository(database);
    const extractor = new MetadataFactExtractor();
    const pipeline = createPipeline(repository, extractor);
    const fixedCollector = collector(item());

    const first = await syncIncrementally(fixedCollector, pipeline, rawItems);
    const second = await syncIncrementally(fixedCollector, pipeline, rawItems);

    assert.deepEqual(first.errors, []);
    assert.equal(second.skipped, 1);
    assert.equal(second.collected, 0);
    assert.equal(extractor.callCount, 1);
    assert.equal((await repository.listContextItems("task")).length, 1);
    assert.equal((await repository.listFactsByRawItemId("raw-lms-1", { includeInactive: true })).length, 1);
    assert.equal((await repository.listEvidenceByContextItemId("ctx-fact-raw-lms-1-hash-v1")).length, 1);
  } finally {
    database.close();
  }
});

test("동일 Fixture를 Pipeline이 직접 재분석해도 Fact 생명주기 오류가 발생하지 않는다", async () => {
  const database = openContextDatabase();
  try {
    const repository = new SQLiteContextRepository(database);
    const pipeline = createPipeline(repository, new MetadataFactExtractor());
    const fixedCollector = collector(item());

    const first = await pipeline.sync(fixedCollector);
    const second = await pipeline.sync(fixedCollector);

    assert.deepEqual(first.errors, []);
    assert.deepEqual(second.errors, []);
    const facts = await repository.listFactsByRawItemId("raw-lms-1", { includeInactive: true });
    assert.equal(facts.length, 1);
    assert.equal(facts[0]?.status, "active");
  } finally {
    database.close();
  }
});

test("학교 사이트와 이메일의 동일 공모전은 SQLite Context 하나에 Evidence를 모두 보존한다", async () => {
  const database = openContextDatabase();
  try {
    const repository = new SQLiteContextRepository(database);
    const rawItems = new SQLiteRawItemRepository(database);
    const pipeline = createPipeline(repository, new MetadataFactExtractor());
    const site = item({
      id: "raw-site-hackathon",
      sourceId: "school-site-main",
      sourceType: "school-site",
      externalId: "notice-hackathon",
      uri: "https://school.example/notices/hackathon",
      title: "대학생 AI 해커톤",
      content: "대학생 AI 해커톤 참가자를 모집합니다.",
      contentHash: "site-hackathon-v1",
      metadata: {
        category: "competition",
        deadline: "2026-07-30T18:00:00+09:00",
        official: true,
      },
    });
    const email = item({
      id: "raw-email-hackathon",
      sourceId: "school-email-main",
      sourceType: "school-email",
      externalId: "message-hackathon",
      uri: "email://school-email-main/hackathon",
      title: "대학생 AI 해커톤",
      content: "학교 홈페이지에 게시된 대학생 AI 해커톤 안내입니다.",
      contentHash: "email-hackathon-v1",
      observedAt: "2026-07-20T09:10:00+09:00",
      metadata: {
        category: "competition",
        deadline: "2026-07-30T18:00:00+09:00",
        official: true,
      },
    });

    assert.deepEqual((await syncIncrementally(collector(site), pipeline, rawItems)).errors, []);
    assert.deepEqual((await syncIncrementally(collector(email), pipeline, rawItems)).errors, []);

    const opportunities = await repository.listContextItems("opportunity");
    assert.equal(opportunities.length, 1);
    assert.equal(opportunities[0]?.evidenceIds.length, 2);
    const storedEvidence = await repository.listEvidenceByContextItemId(opportunities[0]!.id);
    assert.deepEqual(
      new Set(storedEvidence.map((value) => value.rawItemId)),
      new Set([site.id, email.id]),
    );
  } finally {
    database.close();
  }
});

test("수정 Fixture는 이전 Fact를 비활성화하고 Context·Evidence·History를 갱신한다", async () => {
  const database = openContextDatabase();
  try {
    const repository = new SQLiteContextRepository(database);
    const rawItems = new SQLiteRawItemRepository(database);
    const extractor = new MetadataFactExtractor();
    const pipeline = createPipeline(repository, extractor);
    const original = item();
    const updated = item({
      content: "운영체제 과제 1 마감이 연장되었습니다.",
      contentHash: "hash-v2",
      observedAt: "2026-07-21T09:00:00+09:00",
      metadata: {
        course: "운영체제",
        deadline: "2026-07-27T23:59:00+09:00",
        official: true,
      },
    });

    assert.deepEqual((await syncIncrementally(collector(original), pipeline, rawItems)).errors, []);
    assert.deepEqual((await syncIncrementally(collector(updated), pipeline, rawItems)).errors, []);

    const facts = await repository.listFactsByRawItemId(original.id, { includeInactive: true });
    assert.equal(facts.length, 2);
    assert.equal(facts.find((value) => value.id.endsWith("hash-v1"))?.status, "inactive");
    assert.equal(facts.find((value) => value.id.endsWith("hash-v2"))?.status, "active");

    const tasks = await repository.listContextItems("task");
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0]?.deadline, "2026-07-27T23:59:00+09:00");
    assert.equal((await repository.listEvidenceByContextItemId(tasks[0]!.id)).length, 2);
    const history = await repository.listContextHistory(tasks[0]!.id);
    assert.ok(history.some((event) =>
      event.changeType === "field_updated"
      && event.field === "deadline"
      && event.previousValue === "2026-07-25T23:59:00+09:00"
      && event.newValue === "2026-07-27T23:59:00+09:00"
    ));
  } finally {
    database.close();
  }
});

test("한 Source 수집 실패가 다른 Source의 SQLite 동기화를 막지 않는다", async () => {
  const database = openContextDatabase();
  try {
    const repository = new SQLiteContextRepository(database);
    const rawItems = new SQLiteRawItemRepository(database);
    const pipeline = createPipeline(repository, new MetadataFactExtractor());
    const failingCollector: Collector = {
      sourceId: "school-email-main",
      sourceType: "school-email",
      async sync() {
        throw new Error("이메일 Fixture 오류");
      },
    };
    const successful = item({
      id: "raw-site-1",
      sourceId: "school-site-main",
      sourceType: "school-site",
      externalId: "notice-1",
      uri: "https://school.example/notices/1",
      title: "AI 해커톤",
      content: "AI 해커톤 참가자를 모집합니다.",
      contentHash: "site-hash-1",
      metadata: {
        category: "competition",
        deadline: "2026-07-30T18:00:00+09:00",
        official: true,
      },
    });

    const failed = await syncIncrementally(failingCollector, pipeline, rawItems);
    const succeeded = await syncIncrementally(collector(successful), pipeline, rawItems);

    assert.match(failed.errors[0] ?? "", /이메일 Fixture 오류/);
    assert.deepEqual(succeeded.errors, []);
    assert.equal((await repository.listContextItems("opportunity")).length, 1);
    assert.equal((await repository.listFactsByRawItemId(successful.id)).length, 1);
  } finally {
    database.close();
  }
});
