import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryContextRepository } from "../packages/storage/src/index.ts";
import type {
  ContextChangeEvent,
  ContextItem,
  Evidence,
  Fact,
  RawItem,
  RawItemAnalysisResult,
  Recommendation,
} from "../packages/shared/src/index.ts";

const rawItem: RawItem = {
  id: "raw-1",
  sourceId: "lms-main",
  sourceType: "lms",
  uri: "https://lms.example/assignments/1",
  title: "운영체제 과제",
  content: "마감은 7월 25일입니다.",
  contentHash: "hash-1",
  observedAt: "2026-07-20T09:00:00+09:00",
  metadata: {},
};

const fact: Fact = {
  id: "fact-1",
  rawItemId: rawItem.id,
  kind: "deadline",
  subject: "운영체제 과제",
  value: "7월 25일 마감",
  eventTime: "2026-07-25T23:59:00+09:00",
  confidence: 0.95,
  evidenceText: rawItem.content,
};

const evidence: Evidence = {
  id: "ev-1",
  rawItemId: rawItem.id,
  sourceType: "lms",
  location: rawItem.uri,
  quote: rawItem.content,
  observedAt: rawItem.observedAt,
  authority: "official",
};

const contextItem: ContextItem = {
  id: "ctx-1",
  kind: "task",
  title: "운영체제 과제",
  status: "todo",
  deadline: fact.eventTime,
  requirements: [],
  tags: ["운영체제"],
  priority: 50,
  confidence: 0.95,
  evidenceIds: [evidence.id],
  metadata: {},
  createdAt: "2026-07-20T09:00:00+09:00",
  updatedAt: "2026-07-20T09:00:00+09:00",
};

function analysis(overrides: Partial<RawItemAnalysisResult> = {}): RawItemAnalysisResult {
  return {
    rawItem,
    facts: [fact],
    contextItems: [contextItem],
    evidence: [evidence],
    history: [],
    analyzedAt: "2026-07-20T09:01:00+09:00",
    ...overrides,
  };
}

test("InMemory ContextRepository는 동일한 분석 결과를 멱등하게 다시 저장한다", async () => {
  const repository = new InMemoryContextRepository();
  const result = analysis();

  await repository.saveRawItemAnalysis(result);
  await repository.saveRawItemAnalysis(result);

  const active = await repository.listFactsByRawItemId(rawItem.id);
  const all = await repository.listFactsByRawItemId(rawItem.id, { includeInactive: true });
  assert.deepEqual(active.map((item) => item.id), [fact.id]);
  assert.equal(all.length, 1);
  assert.equal(all[0]?.status, "active");
  assert.equal(all[0]?.supersededAt, undefined);
});

test("ContextRepository는 Fact를 ID 기준 upsert하고 RawItem 기준으로 조회한다", async () => {
  const repository = new InMemoryContextRepository();
  await repository.saveFacts([fact]);
  await repository.saveFacts([{ ...fact, value: "7월 26일로 변경" }]);

  const facts = await repository.listFactsByRawItemId(rawItem.id);
  assert.equal(facts.length, 1);
  assert.equal(facts[0]?.value, "7월 26일로 변경");
  assert.equal(facts[0]?.status, "active");
});

test("RawItem 재분석은 기존 Fact를 삭제하지 않고 비활성화한다", async () => {
  const repository = new InMemoryContextRepository();
  await repository.saveFacts([fact]);
  await repository.deactivateFactsByRawItemId(rawItem.id, "2026-07-21T09:00:00+09:00");

  assert.deepEqual(await repository.listFactsByRawItemId(rawItem.id), []);
  const all = await repository.listFactsByRawItemId(rawItem.id, { includeInactive: true });
  assert.equal(all.length, 1);
  assert.equal(all[0]?.status, "inactive");
  assert.equal(all[0]?.supersededAt, "2026-07-21T09:00:00+09:00");

  await assert.rejects(repository.saveFacts([fact]), /비활성 Fact ID는 새 분석에서 재사용할 수 없습니다/);
});

test("Evidence는 ContextItem ID로 조회할 수 있다", async () => {
  const repository = new InMemoryContextRepository();
  await repository.saveContextItems([contextItem]);
  await repository.saveEvidence([evidence]);

  assert.deepEqual(await repository.listEvidenceByContextItemId(contextItem.id), [evidence]);
  assert.deepEqual(await repository.listEvidenceByContextItemId("missing"), []);
});

test("Context History는 append-only이며 같은 이벤트의 멱등 저장만 허용한다", async () => {
  const repository = new InMemoryContextRepository();
  const event: ContextChangeEvent = {
    id: "history-1",
    contextItemId: contextItem.id,
    changeType: "field_updated",
    field: "deadline",
    previousValue: "2026-07-25T23:59:00+09:00",
    newValue: "2026-07-26T23:59:00+09:00",
    evidenceId: evidence.id,
    changedAt: "2026-07-21T09:00:00+09:00",
  };

  await repository.saveContextHistory([event]);
  await repository.saveContextHistory([event]);
  assert.equal((await repository.listContextHistory(contextItem.id)).length, 1);

  await assert.rejects(
    repository.saveContextHistory([{ ...event, newValue: "2026-07-27T23:59:00+09:00" }]),
    /변경 이력은 수정할 수 없습니다/,
  );
});

test("Recommendation은 서로 다른 ID의 이력을 보존하고 같은 ID는 upsert한다", async () => {
  const repository = new InMemoryContextRepository();
  const first: Recommendation = {
    id: "rec-1",
    contextItemId: contextItem.id,
    action: "보고서를 작성하세요.",
    reason: "마감이 가깝습니다.",
    score: 80,
    evidenceIds: [evidence.id],
    createdAt: "2026-07-20T10:00:00+09:00",
  };
  const second: Recommendation = {
    ...first,
    id: "rec-2",
    createdAt: "2026-07-21T10:00:00+09:00",
  };

  await repository.saveRecommendations([first, second]);
  await repository.saveRecommendations([{ ...first, score: 85 }]);
  const stored = await repository.listRecommendations(contextItem.id);

  assert.equal(stored.length, 2);
  assert.equal(stored.find((item) => item.id === first.id)?.score, 85);
});

test("RawItem 분석 저장은 중간 충돌 시 전체를 rollback한다", async () => {
  const repository = new InMemoryContextRepository();
  const originalHistory: ContextChangeEvent = {
    id: "history-conflict",
    contextItemId: contextItem.id,
    changeType: "created",
    changedAt: "2026-07-20T09:01:00+09:00",
  };
  await repository.saveRawItemAnalysis(analysis({ history: [originalHistory] }));

  const newFact: Fact = { ...fact, id: "fact-2", value: "변경된 마감" };
  const changedContext = { ...contextItem, title: "저장되면 안 되는 제목" };
  const conflictingHistory = { ...originalHistory, changeType: "merged" as const };

  await assert.rejects(repository.saveRawItemAnalysis(analysis({
    facts: [newFact],
    contextItems: [changedContext],
    history: [conflictingHistory],
    analyzedAt: "2026-07-21T09:01:00+09:00",
  })), /변경 이력은 수정할 수 없습니다/);

  const facts = await repository.listFactsByRawItemId(rawItem.id, { includeInactive: true });
  assert.deepEqual(facts.map((item) => [item.id, item.status]), [[fact.id, "active"]]);
  assert.equal((await repository.findContextItem(contextItem.id))?.title, contextItem.title);
});
