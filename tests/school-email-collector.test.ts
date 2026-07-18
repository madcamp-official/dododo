import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  SchoolEmailCollector,
  type SchoolEmailInput,
} from "../packages/collectors/src/index.ts";
import {
  openRawItemDatabase,
  RawItemSyncService,
  SQLiteRawItemRepository,
} from "../packages/storage/src/index.ts";

const fixtureDirectory = "fixtures/school-email";
const observedAt = new Date("2026-07-18T12:00:00+09:00");

test("학교 .eml에서 Message-ID, 주소, 본문과 첨부 Metadata를 추출한다", async () => {
  const collector = createCollector(async () => [await fixture("ai-hackathon.eml")]);

  const [item] = await collector.sync();

  assert.equal(item?.sourceType, "school-email");
  assert.equal(item?.externalId, "<ai-hackathon-1542@school.example>");
  assert.equal(item?.metadata.from, "student-support@school.example");
  assert.deepEqual(item?.metadata.to, ["student@school.example"]);
  assert.match(item?.content ?? "", /신청 마감은 2026년 7월 25일 18시/);
  const attachments = item?.metadata.attachments as Array<Record<string, unknown>>;
  assert.equal(attachments.length, 1);
  assert.equal(attachments[0]?.filename, "guide.pdf");
  assert.equal(attachments[0]?.contentType, "application/pdf");
  assert.equal(typeof attachments[0]?.size, "number");
  assert.equal("content" in attachments[0]!, false);
});

test("HTML-only 학교 이메일을 정규화된 텍스트로 변환한다", async () => {
  const collector = createCollector(async () => [await fixture("html-announcement.eml")]);

  const [item] = await collector.sync();

  assert.equal(item?.metadata.from, "office@cs.school.example");
  assert.match(item?.content ?? "", /운영체제 수업 안내/);
  assert.match(item?.content ?? "", /다음 수업은 7월 20일에 진행합니다/);
  assert.doesNotMatch(item?.content ?? "", /<strong>/);
});

test("허용되지 않은 외부 발신자 이메일은 수집하지 않는다", async () => {
  const collector = createCollector(async () => [await fixture("external-sender.eml")]);

  assert.deepEqual(await collector.sync(), []);
  assert.deepEqual(collector.listErrors(), []);
});

test("잘못된 이메일 하나는 오류로 기록하고 다른 이메일 수집을 계속한다", async () => {
  const collector = createCollector(async () => [
    { raw: "From: missing-message-id@school.example\n\n본문", sourceUri: "fixture://invalid" },
    await fixture("html-announcement.eml"),
  ]);

  const items = await collector.sync();

  assert.equal(items.length, 1);
  assert.deepEqual(collector.listErrors(), [{
    sourceUri: "fixture://invalid",
    message: "이메일 Message-ID가 없습니다",
  }]);
});

test("허용 크기를 넘는 이메일은 파싱하지 않고 오류로 기록한다", async () => {
  const collector = new SchoolEmailCollector({
    sourceId: "school-email-main",
    allowedSenderDomains: ["school.example"],
    maxMessageBytes: 5,
    loadMessages: async () => [{ raw: "123456", sourceUri: "fixture://large" }],
    now: () => observedAt,
  });

  assert.deepEqual(await collector.sync(), []);
  assert.match(collector.listErrors()[0]?.message ?? "", /허용 크기\(5 bytes\)를 초과/);
});

test("동일 학교 이메일은 SQLite에서 created, skipped, updated로 판정된다", async () => {
  const original = await fixture("ai-hackathon.eml");
  let raw = original.raw;
  const collector = createCollector(async () => [{ raw }]);
  const database = openRawItemDatabase();

  try {
    const service = new RawItemSyncService(new SQLiteRawItemRepository(database));
    const first = await service.sync(await collector.sync());
    const second = await service.sync(await collector.sync());
    raw = raw.toString().replace(
      "2026년 7월 25일 18시",
      "2026년 7월 27일 18시",
    );
    const third = await service.sync(await collector.sync());

    assert.equal(first.created, 1);
    assert.equal(second.skipped, 1);
    assert.equal(second.itemsToAnalyze.length, 0);
    assert.equal(third.updated, 1);
    assert.equal(third.itemsToAnalyze.length, 1);
  } finally {
    database.close();
  }
});

function createCollector(
  loadMessages: () => Promise<SchoolEmailInput[]>,
): SchoolEmailCollector {
  return new SchoolEmailCollector({
    sourceId: "school-email-main",
    allowedSenderDomains: ["school.example"],
    loadMessages,
    now: () => observedAt,
  });
}

async function fixture(name: string): Promise<SchoolEmailInput> {
  return {
    raw: await readFile(`${fixtureDirectory}/${name}`),
    sourceUri: `fixture://${name}`,
  };
}
