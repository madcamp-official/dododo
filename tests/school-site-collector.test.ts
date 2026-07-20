import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  parseSchoolNoticeHtml,
  SchoolSiteCollector,
} from "../packages/collectors/src/index.ts";
import {
  openRawItemDatabase,
  RawItemSyncService,
  SQLiteRawItemRepository,
} from "../packages/storage/src/index.ts";

const fixturePath = "fixtures/school-site/notices.html";
const baseUrl = "https://school.example/";
const observedAt = new Date("2026-07-18T12:00:00+09:00");

test("학교 공지 HTML에서 유효한 공지를 추출하고 누락·잘못된 URL 항목은 제외한다", async () => {
  const html = await readFile(fixturePath, "utf8");

  const notices = parseSchoolNoticeHtml(html, { baseUrl });

  assert.equal(notices.length, 1);
  assert.equal(notices[0]?.externalId, "notice-1542");
  assert.equal(notices[0]?.title, "대학생 AI 해커톤 참가자 모집");
  assert.equal(notices[0]?.uri, "https://school.example/notices/1542");
  assert.equal(
    notices[0]?.content,
    "대학생 AI 해커톤 참가자를 모집합니다. 신청 마감은 2026년 7월 25일 18시입니다.",
  );
  assert.deepEqual(notices[0]?.attachmentUrls, [
    "https://school.example/files/ai-hackathon-guide.pdf",
  ]);
});

test("학교 공지와 첨부 링크는 HTTP 또는 HTTPS 프로토콜만 허용한다", () => {
  const html = `
    <article class="notice-item" data-notice-id="unsafe-notice">
      <a class="notice-link" href="javascript:alert('unsafe')">위험한 공지</a>
      <div class="notice-content">저장하면 안 되는 공지입니다.</div>
    </article>
    <article class="notice-item" data-notice-id="safe-notice">
      <a class="notice-link" href="/notices/safe">정상 공지</a>
      <div class="notice-content">안전한 링크만 저장합니다.</div>
      <a class="notice-attachment" href="/files/safe.pdf">정상 첨부</a>
      <a class="notice-attachment" href="data:text/plain,unsafe">Data 첨부</a>
      <a class="notice-attachment" href="file:///etc/passwd">File 첨부</a>
      <a class="notice-attachment" href="javascript:alert('unsafe')">Script 첨부</a>
    </article>
  `;

  const notices = parseSchoolNoticeHtml(html, { baseUrl });

  assert.equal(notices.length, 1);
  assert.equal(notices[0]?.externalId, "safe-notice");
  assert.equal(notices[0]?.uri, "https://school.example/notices/safe");
  assert.deepEqual(notices[0]?.attachmentUrls, [
    "https://school.example/files/safe.pdf",
  ]);
});

test("SchoolSiteCollector는 같은 HTML에서 안정적인 ID와 Hash를 생성한다", async () => {
  const html = await readFile(fixturePath, "utf8");
  const collector = createCollector(async () => html);

  const first = await collector.sync();
  const second = await collector.sync();

  assert.equal(first.length, 1);
  assert.equal(first[0]?.id, second[0]?.id);
  assert.equal(first[0]?.contentHash, second[0]?.contentHash);
  assert.equal(first[0]?.observedAt, observedAt.toISOString());
  assert.deepEqual(first[0]?.metadata, {
    official: true,
    attachmentUrls: ["https://school.example/files/ai-hackathon-guide.pdf"],
    publishedAt: "2026-07-18T09:00:00+09:00",
    category: "competition",
  });
});

test("학교 공지 본문이 바뀌면 contentHash가 변경된다", async () => {
  const originalHtml = await readFile(fixturePath, "utf8");
  let html = originalHtml;
  const collector = createCollector(async () => html);

  const [original] = await collector.sync();
  html = originalHtml.replace(
    "2026년 7월 25일 18시",
    "2026년 7월 27일 18시",
  );
  const [modified] = await collector.sync();

  assert.notEqual(original?.contentHash, modified?.contentHash);
});

test("빈 공지 목록은 빈 RawItem 배열을 반환한다", async () => {
  const collector = createCollector(async () => "<html><body></body></html>");

  assert.deepEqual(await collector.sync(), []);
});

test("학교 공지 HTML은 SQLite 동기화에서 created, skipped, updated로 판정된다", async () => {
  const originalHtml = await readFile(fixturePath, "utf8");
  let html = originalHtml;
  const collector = createCollector(async () => html);
  const database = openRawItemDatabase();

  try {
    const service = new RawItemSyncService(new SQLiteRawItemRepository(database));
    const first = await service.sync(await collector.sync());
    const second = await service.sync(await collector.sync());
    html = originalHtml.replace(
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

function createCollector(loadHtml: () => Promise<string>): SchoolSiteCollector {
  return new SchoolSiteCollector({
    sourceId: "school-site-main",
    baseUrl,
    loadHtml,
    now: () => observedAt,
  });
}
