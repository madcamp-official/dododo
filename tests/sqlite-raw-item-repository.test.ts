import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { RawItem } from "../packages/shared/src/index.ts";
import {
  openRawItemDatabase,
  SQLiteRawItemRepository,
} from "../packages/storage/src/index.ts";

function rawItem(overrides: Partial<RawItem> = {}): RawItem {
  return {
    id: "raw-lms-001",
    sourceId: "lms-main",
    sourceType: "lms",
    externalId: "course-os-assignment-3",
    uri: "https://lms.example/courses/os/assignments/3",
    title: "운영체제 과제 3",
    content: "보고서 PDF와 소스코드 ZIP을 제출합니다.",
    contentHash: "hash-v1",
    observedAt: "2026-07-18T09:20:00+09:00",
    metadata: { course: "운영체제", official: true },
    ...overrides,
  };
}

test("SQLite RawItem을 저장하고 metadata를 포함해 조회한다", async () => {
  const database = openRawItemDatabase();
  try {
    const repository = new SQLiteRawItemRepository(database);
    const item = rawItem();

    const result = await repository.save(item);

    assert.equal(result.status, "created");
    assert.deepEqual(await repository.findById(item.id), item);
  } finally {
    database.close();
  }
});

test("SQLite에서 같은 externalId와 hash를 skipped로 판정한다", async () => {
  const database = openRawItemDatabase();
  try {
    const repository = new SQLiteRawItemRepository(database);
    await repository.save(rawItem());

    const result = await repository.save(rawItem({ id: "raw-recollected" }));

    assert.equal(result.status, "skipped");
    assert.equal(result.item.id, "raw-lms-001");
  } finally {
    database.close();
  }
});

test("SQLite에서 contentHash 변경을 updated로 판정하고 기존 ID를 유지한다", async () => {
  const database = openRawItemDatabase();
  try {
    const repository = new SQLiteRawItemRepository(database);
    await repository.save(rawItem());

    const result = await repository.save(rawItem({
      id: "raw-new-observation",
      content: "마감이 연장되었습니다.",
      contentHash: "hash-v2",
    }));

    assert.equal(result.status, "updated");
    assert.equal(result.previousHash, "hash-v1");
    assert.equal(result.item.id, "raw-lms-001");
    assert.equal((await repository.findById("raw-lms-001"))?.contentHash, "hash-v2");
  } finally {
    database.close();
  }
});

test("같은 Source와 URI라도 externalId가 다르면 SQLite에 별도 저장한다", async () => {
  const database = openRawItemDatabase();
  try {
    const repository = new SQLiteRawItemRepository(database);
    const sharedUri = "https://school.example/notices";
    const first = rawItem({
      id: "raw-notice-1",
      sourceId: "school-site-main",
      sourceType: "school-site",
      externalId: "notice-1",
      uri: sharedUri,
    });
    const second = rawItem({
      id: "raw-notice-2",
      sourceId: "school-site-main",
      sourceType: "school-site",
      externalId: "notice-2",
      uri: sharedUri,
      contentHash: "hash-notice-2",
    });

    assert.equal((await repository.save(first)).status, "created");
    assert.equal((await repository.save(second)).status, "created");
    assert.equal(
      (await repository.findByExternalId(first.sourceId, "notice-1"))?.id,
      first.id,
    );
    assert.equal(
      (await repository.findByExternalId(second.sourceId, "notice-2"))?.id,
      second.id,
    );
  } finally {
    database.close();
  }
});

test("externalId가 없는 RawItem은 SQLite에서 sourceId와 URI로 판정한다", async () => {
  const database = openRawItemDatabase();
  try {
    const repository = new SQLiteRawItemRepository(database);
    const item = rawItem({ externalId: undefined });
    await repository.save(item);

    const result = await repository.save(rawItem({
      id: "raw-uri-recollected",
      externalId: undefined,
    }));

    assert.equal(result.status, "skipped");
    assert.equal((await repository.findByUri(item.sourceId, item.uri))?.id, item.id);
  } finally {
    database.close();
  }
});

test("SQLite DB를 닫고 다시 열어도 동일 RawItem을 skipped로 판정한다", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dododo-sqlite-"));
  const databasePath = join(directory, "context.db");

  try {
    const firstDatabase = openRawItemDatabase(databasePath);
    const firstRepository = new SQLiteRawItemRepository(firstDatabase);
    assert.equal((await firstRepository.save(rawItem())).status, "created");
    firstDatabase.close();

    const secondDatabase = openRawItemDatabase(databasePath);
    try {
      const secondRepository = new SQLiteRawItemRepository(secondDatabase);
      const result = await secondRepository.save(rawItem({ id: "raw-after-restart" }));

      assert.equal(result.status, "skipped");
      assert.equal(result.item.id, "raw-lms-001");
      assert.deepEqual(result.item.metadata, { course: "운영체제", official: true });
    } finally {
      secondDatabase.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
