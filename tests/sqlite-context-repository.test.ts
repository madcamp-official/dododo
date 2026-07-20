import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type {
  ContextChangeEvent,
  ContextItem,
  Evidence,
  Fact,
  RawItem,
  RawItemAnalysisResult,
  Recommendation,
} from "../packages/shared/src/index.ts";
import {
  openContextDatabase,
  SQLiteContextRepository,
} from "../packages/storage/src/index.ts";

function rawItem(overrides: Partial<RawItem> = {}): RawItem {
  return {
    id: "raw-lms-1",
    sourceId: "lms-main",
    sourceType: "lms",
    externalId: "assignment-1",
    uri: "https://lms.example/assignments/1",
    title: "운영체제 과제",
    content: "7월 25일까지 보고서를 제출합니다.",
    contentHash: "hash-v1",
    observedAt: "2026-07-20T09:00:00+09:00",
    metadata: { course: "운영체제" },
    ...overrides,
  };
}

function fact(item: RawItem, overrides: Partial<Fact> = {}): Fact {
  return {
    id: `fact-${item.id}-${item.contentHash}`,
    rawItemId: item.id,
    kind: "deadline",
    subject: "운영체제 과제",
    value: "7월 25일 마감",
    eventTime: "2026-07-25T23:59:00+09:00",
    confidence: 0.95,
    evidenceText: item.content,
    ...overrides,
  };
}

function evidence(item: RawItem, overrides: Partial<Evidence> = {}): Evidence {
  return {
    id: `ev-${item.contentHash}`,
    rawItemId: item.id,
    sourceType: item.sourceType,
    location: item.uri,
    quote: item.content,
    observedAt: item.observedAt,
    authority: "official",
    ...overrides,
  };
}

function contextItem(evidenceId: string, overrides: Partial<ContextItem> = {}): ContextItem {
  return {
    id: "ctx-os-1",
    kind: "task",
    title: "운영체제 과제",
    status: "todo",
    deadline: "2026-07-25T23:59:00+09:00",
    requirements: ["보고서"],
    tags: ["운영체제"],
    priority: 50,
    confidence: 0.95,
    evidenceIds: [evidenceId],
    metadata: { course: "운영체제" },
    createdAt: "2026-07-20T09:00:00+09:00",
    updatedAt: "2026-07-20T09:00:00+09:00",
    ...overrides,
  };
}

function analysis(item: RawItem, overrides: Partial<RawItemAnalysisResult> = {}): RawItemAnalysisResult {
  const itemEvidence = evidence(item);
  return {
    rawItem: item,
    facts: [fact(item)],
    contextItems: [contextItem(itemEvidence.id)],
    evidence: [itemEvidence],
    history: [],
    analyzedAt: item.observedAt,
    ...overrides,
  };
}

test("SQLite ContextRepository는 전체 분석 결과를 저장하고 다시 조회한다", async () => {
  const database = openContextDatabase();
  try {
    const repository = new SQLiteContextRepository(database);
    const item = rawItem();
    await repository.saveRawItemAnalysis(analysis(item));

    assert.equal((await repository.listFactsByRawItemId(item.id)).length, 1);
    assert.deepEqual(await repository.listContextItems("task"), [contextItem("ev-hash-v1")]);
    assert.deepEqual(
      await repository.listEvidenceByContextItemId("ctx-os-1"),
      [evidence(item)],
    );
  } finally {
    database.close();
  }
});

test("SQLite ContextItem과 Recommendation은 ID 기준 upsert하고 추천 이력을 보존한다", async () => {
  const database = openContextDatabase();
  try {
    const repository = new SQLiteContextRepository(database);
    const item = rawItem();
    await repository.saveRawItemAnalysis(analysis(item));
    await repository.saveContextItems([contextItem("ev-hash-v1", { priority: 80 })]);

    const first: Recommendation = {
      id: "rec-1", contextItemId: "ctx-os-1", action: "보고서를 작성하세요.",
      reason: "마감 임박", score: 70, evidenceIds: ["ev-hash-v1"],
      createdAt: "2026-07-20T10:00:00+09:00",
    };
    const second = { ...first, id: "rec-2", createdAt: "2026-07-21T10:00:00+09:00" };
    await repository.saveRecommendations([first, second]);
    await repository.saveRecommendations([{ ...first, score: 90 }]);

    assert.equal((await repository.findContextItem("ctx-os-1"))?.priority, 80);
    const recommendations = await repository.listRecommendations("ctx-os-1");
    assert.equal(recommendations.length, 2);
    assert.equal(recommendations.find((value) => value.id === "rec-1")?.score, 90);
  } finally {
    database.close();
  }
});

test("SQLite 재분석은 이전 Fact를 비활성화하고 새 버전을 활성 상태로 보존한다", async () => {
  const database = openContextDatabase();
  try {
    const repository = new SQLiteContextRepository(database);
    const first = rawItem();
    await repository.saveRawItemAnalysis(analysis(first));

    const second = rawItem({
      content: "마감이 7월 27일로 연장되었습니다.",
      contentHash: "hash-v2",
      observedAt: "2026-07-21T09:00:00+09:00",
    });
    await repository.saveRawItemAnalysis(analysis(second));

    const active = await repository.listFactsByRawItemId(first.id);
    const all = await repository.listFactsByRawItemId(first.id, { includeInactive: true });
    assert.deepEqual(active.map((value) => value.id), ["fact-raw-lms-1-hash-v2"]);
    assert.equal(all.length, 2);
    assert.equal(all.find((value) => value.id.endsWith("hash-v1"))?.status, "inactive");
    assert.equal(
      all.find((value) => value.id.endsWith("hash-v1"))?.supersededAt,
      second.observedAt,
    );
  } finally {
    database.close();
  }
});

test("SQLite Context History는 append-only이고 같은 이벤트만 멱등 허용한다", async () => {
  const database = openContextDatabase();
  try {
    const repository = new SQLiteContextRepository(database);
    const item = rawItem();
    await repository.saveRawItemAnalysis(analysis(item));
    const event: ContextChangeEvent = {
      id: "history-1",
      contextItemId: "ctx-os-1",
      changeType: "field_updated",
      field: "deadline",
      previousValue: "2026-07-25T23:59:00+09:00",
      newValue: "2026-07-27T23:59:00+09:00",
      evidenceId: "ev-hash-v1",
      changedAt: "2026-07-21T09:00:00+09:00",
    };
    await repository.saveContextHistory([event]);
    await repository.saveContextHistory([event]);

    assert.deepEqual(await repository.listContextHistory("ctx-os-1"), [event]);
    await assert.rejects(
      repository.saveContextHistory([{ ...event, newValue: "다른 값" }]),
      /변경 이력은 수정할 수 없습니다/,
    );
  } finally {
    database.close();
  }
});

test("SQLite RawItem 분석 transaction은 History 충돌 시 전체 rollback한다", async () => {
  const database = openContextDatabase();
  try {
    const repository = new SQLiteContextRepository(database);
    const first = rawItem();
    const originalHistory: ContextChangeEvent = {
      id: "history-conflict",
      contextItemId: "ctx-os-1",
      changeType: "created",
      changedAt: first.observedAt,
    };
    await repository.saveRawItemAnalysis(analysis(first, { history: [originalHistory] }));

    const second = rawItem({ content: "변경", contentHash: "hash-v2" });
    await assert.rejects(repository.saveRawItemAnalysis(analysis(second, {
      contextItems: [contextItem("ev-hash-v2", { title: "rollback 대상" })],
      history: [{ ...originalHistory, changeType: "merged" }],
    })), /변경 이력은 수정할 수 없습니다/);

    const facts = await repository.listFactsByRawItemId(first.id, { includeInactive: true });
    assert.deepEqual(facts.map((value) => [value.id, value.status]), [
      ["fact-raw-lms-1-hash-v1", "active"],
    ]);
    assert.equal((await repository.findContextItem("ctx-os-1"))?.title, "운영체제 과제");
    assert.deepEqual(await repository.listEvidence(["ev-hash-v2"]), []);
  } finally {
    database.close();
  }
});

test("SQLite Context 데이터는 DB 재시작 후에도 유지된다", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dododo-context-sqlite-"));
  const path = join(directory, "context.db");
  try {
    const firstDatabase = openContextDatabase(path);
    const firstRepository = new SQLiteContextRepository(firstDatabase);
    await firstRepository.saveRawItemAnalysis(analysis(rawItem()));
    firstDatabase.close();

    const secondDatabase = openContextDatabase(path);
    try {
      const secondRepository = new SQLiteContextRepository(secondDatabase);
      assert.equal((await secondRepository.listFactsByRawItemId("raw-lms-1")).length, 1);
      assert.equal((await secondRepository.listContextItems("task")).length, 1);
      assert.equal((await secondRepository.listEvidenceByContextItemId("ctx-os-1")).length, 1);
    } finally {
      secondDatabase.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
