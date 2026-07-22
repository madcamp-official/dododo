import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryRawItemRepository } from "../packages/storage/src/index.ts";
import type { RawItem } from "../packages/shared/src/index.ts";

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

test("처음 저장한 RawItem은 created로 판정한다", async () => {
  const repository = new InMemoryRawItemRepository();
  const item = rawItem();

  const result = await repository.save(item);

  assert.equal(result.status, "created");
  assert.deepEqual(await repository.findById(item.id), item);
});

test("동일 externalId와 contentHash는 skipped로 판정한다", async () => {
  const repository = new InMemoryRawItemRepository();
  await repository.save(rawItem());

  const result = await repository.save(rawItem({ id: "raw-recollected" }));

  assert.equal(result.status, "skipped");
  assert.equal(result.item.id, "raw-lms-001");
});

test("동일 externalId의 contentHash가 바뀌면 updated로 판정한다", async () => {
  const repository = new InMemoryRawItemRepository();
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
  assert.equal(await repository.findById("raw-new-observation"), undefined);
});

test("같은 externalId라도 sourceId가 다르면 별도 항목으로 저장한다", async () => {
  const repository = new InMemoryRawItemRepository();

  const first = await repository.save(rawItem());
  const second = await repository.save(rawItem({
    id: "raw-other-source",
    sourceId: "lms-secondary",
  }));

  assert.equal(first.status, "created");
  assert.equal(second.status, "created");
});

test("같은 Source와 URI라도 externalId가 다르면 별도 항목으로 저장한다", async () => {
  const repository = new InMemoryRawItemRepository();
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
    content: "두 번째 공지",
    contentHash: "hash-notice-2",
  });

  const firstResult = await repository.save(first);
  const secondResult = await repository.save(second);

  assert.equal(firstResult.status, "created");
  assert.equal(secondResult.status, "created");
  assert.equal(
    (await repository.findByExternalId(first.sourceId, "notice-1"))?.id,
    first.id,
  );
  assert.equal(
    (await repository.findByExternalId(second.sourceId, "notice-2"))?.id,
    second.id,
  );
  assert.equal((await repository.findById(first.id))?.content, first.content);
});

test("externalId가 없으면 sourceId와 uri로 중복을 판정한다", async () => {
  const repository = new InMemoryRawItemRepository();
  const item = rawItem({ externalId: undefined });
  await repository.save(item);

  const result = await repository.save(rawItem({
    id: "raw-uri-recollected",
    externalId: undefined,
  }));

  assert.equal(result.status, "skipped");
  assert.equal((await repository.findByUri(item.sourceId, item.uri))?.id, item.id);
});

test("반환하거나 조회한 객체를 수정해도 저장된 RawItem은 바뀌지 않는다", async () => {
  const repository = new InMemoryRawItemRepository();
  const input = rawItem();
  const result = await repository.save(input);

  input.content = "입력 객체 수정";
  result.item.metadata.course = "반환 객체 수정";
  const found = await repository.findById(input.id);
  if (found !== undefined) found.content = "조회 객체 수정";

  const stored = await repository.findById(input.id);
  assert.equal(stored?.content, "보고서 PDF와 소스코드 ZIP을 제출합니다.");
  assert.equal(stored?.metadata.course, "운영체제");
});

test("Source 종류별 최근 RawItem을 관찰 시각 역순과 limit으로 조회한다", async () => {
  const repository = new InMemoryRawItemRepository();
  await repository.save(rawItem({ id: "site-old", sourceId: "site", sourceType: "school-site", externalId: "old", observedAt: "2026-07-20T00:00:00Z" }));
  await repository.save(rawItem({ id: "site-new", sourceId: "site", sourceType: "school-site", externalId: "new", observedAt: "2026-07-22T00:00:00Z" }));
  await repository.save(rawItem({ id: "mail", sourceId: "mail", sourceType: "school-email", externalId: "mail" }));

  const items = await repository.listBySourceType("school-site", 1);

  assert.deepEqual(items.map((item) => item.id), ["site-new"]);
});
