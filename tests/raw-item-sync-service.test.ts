import assert from "node:assert/strict";
import test from "node:test";

import { JsonFixtureCollector } from "../packages/collectors/src/index.ts";
import type { RawItem } from "../packages/shared/src/index.ts";
import {
  InMemoryRawItemRepository,
  RawItemSyncService,
} from "../packages/storage/src/index.ts";
import type {
  RawItemRepository,
  RawItemSaveResult,
} from "../packages/storage/src/index.ts";

function rawItem(id: string, overrides: Partial<RawItem> = {}): RawItem {
  return {
    id,
    sourceId: "lms-main",
    sourceType: "lms",
    externalId: `assignment-${id}`,
    uri: `https://lms.example/assignments/${id}`,
    title: `과제 ${id}`,
    content: `${id}번 과제를 제출합니다.`,
    contentHash: `hash-${id}-v1`,
    observedAt: "2026-07-18T09:20:00+09:00",
    metadata: {},
    ...overrides,
  };
}

test("처음 동기화한 RawItem을 모두 created와 분석 대상으로 집계한다", async () => {
  const service = new RawItemSyncService(new InMemoryRawItemRepository());

  const summary = await service.sync([
    rawItem("1"),
    rawItem("2"),
    rawItem("3"),
  ]);

  assert.equal(summary.collected, 3);
  assert.equal(summary.created, 3);
  assert.equal(summary.updated, 0);
  assert.equal(summary.skipped, 0);
  assert.equal(summary.itemsToAnalyze.length, 3);
  assert.equal(summary.results.length, 3);
  assert.deepEqual(summary.errors, []);
});

test("동일 입력을 다시 동기화하면 모두 skipped이고 분석 대상이 없다", async () => {
  const service = new RawItemSyncService(new InMemoryRawItemRepository());
  const items = [rawItem("1"), rawItem("2"), rawItem("3")];
  await service.sync(items);

  const summary = await service.sync(items);

  assert.equal(summary.created, 0);
  assert.equal(summary.updated, 0);
  assert.equal(summary.skipped, 3);
  assert.deepEqual(summary.itemsToAnalyze, []);
});

test("일부 내용이 바뀌면 수정된 RawItem만 분석 대상으로 반환한다", async () => {
  const service = new RawItemSyncService(new InMemoryRawItemRepository());
  await service.sync([rawItem("1"), rawItem("2"), rawItem("3")]);

  const summary = await service.sync([
    rawItem("1"),
    rawItem("2", {
      content: "2번 과제 마감이 연장되었습니다.",
      contentHash: "hash-2-v2",
    }),
    rawItem("3"),
  ]);

  assert.equal(summary.created, 0);
  assert.equal(summary.updated, 1);
  assert.equal(summary.skipped, 2);
  assert.equal(summary.itemsToAnalyze.length, 1);
  assert.equal(summary.itemsToAnalyze[0]?.externalId, "assignment-2");
});

test("기존 입력과 함께 들어온 신규 RawItem만 created와 분석 대상으로 집계한다", async () => {
  const service = new RawItemSyncService(new InMemoryRawItemRepository());
  await service.sync([rawItem("1"), rawItem("2")]);

  const summary = await service.sync([
    rawItem("1"),
    rawItem("2"),
    rawItem("3"),
  ]);

  assert.equal(summary.created, 1);
  assert.equal(summary.skipped, 2);
  assert.equal(summary.itemsToAnalyze.length, 1);
  assert.equal(summary.itemsToAnalyze[0]?.id, "3");
});

test("RawItem 하나의 저장 실패가 나머지 항목의 동기화를 중단하지 않는다", async () => {
  const repository = new FailingRawItemRepository("2");
  const service = new RawItemSyncService(repository);

  const summary = await service.sync([
    rawItem("1"),
    rawItem("2"),
    rawItem("3"),
  ]);

  assert.equal(summary.collected, 3);
  assert.equal(summary.created, 2);
  assert.equal(summary.results.length, 2);
  assert.equal(summary.itemsToAnalyze.length, 2);
  assert.deepEqual(summary.errors, [{
    rawItemId: "2",
    message: "테스트 저장 실패: 2",
  }]);
});

test("JSON Fixture는 첫 동기화 후 동일 입력 재동기화에서 skipped가 된다", async () => {
  const collector = new JsonFixtureCollector(
    "lms-main",
    "lms",
    ["fixtures/lms/os-assignment.json"],
  );
  const service = new RawItemSyncService(new InMemoryRawItemRepository());
  const items = await collector.sync();

  const first = await service.sync(items);
  const second = await service.sync(items);

  assert.equal(first.created, 1);
  assert.equal(first.itemsToAnalyze.length, 1);
  assert.equal(second.skipped, 1);
  assert.equal(second.itemsToAnalyze.length, 0);
});

class FailingRawItemRepository implements RawItemRepository {
  private readonly delegate = new InMemoryRawItemRepository();
  private readonly failingId: string;

  constructor(failingId: string) {
    this.failingId = failingId;
  }

  async save(item: RawItem): Promise<RawItemSaveResult> {
    if (item.id === this.failingId) {
      throw new Error(`테스트 저장 실패: ${item.id}`);
    }
    return this.delegate.save(item);
  }

  findById(id: string): Promise<RawItem | undefined> {
    return this.delegate.findById(id);
  }

  findByExternalId(sourceId: string, externalId: string): Promise<RawItem | undefined> {
    return this.delegate.findByExternalId(sourceId, externalId);
  }

  findByUri(sourceId: string, uri: string): Promise<RawItem | undefined> {
    return this.delegate.findByUri(sourceId, uri);
  }
}
