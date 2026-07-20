import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  collectSources,
  LmsCollector,
  SchoolEmailCollector,
  SchoolSiteCollector,
  type LmsHtmlSelectors,
} from "../packages/collectors/src/index.ts";
import type { Collector } from "../packages/shared/src/index.ts";

const observedAt = new Date("2026-07-18T12:00:00+09:00");
const lmsSelectors: LmsHtmlSelectors = {
  item: ".notice",
  externalId: "::attr(data-item-id)",
  course: ".course",
  category: ".category",
  title: ".title",
  content: ".body",
  publishedAt: ".published::attr(datetime)",
  dueAt: ".due::attr(datetime)",
  link: ".detail::attr(href)",
};

function actualFormatCollectors(): Collector[] {
  return [
    new SchoolSiteCollector({
      sourceId: "school-site-main",
      baseUrl: "https://school.example/",
      loadHtml: () => readFile("fixtures/school-site/notices.html", "utf8"),
      now: () => observedAt,
    }),
    new SchoolEmailCollector({
      sourceId: "school-email-main",
      allowedSenderDomains: ["school.example"],
      loadMessages: async () => [{
        raw: await readFile("fixtures/school-email/ai-hackathon.eml"),
        sourceUri: "fixture://school-email/ai-hackathon.eml",
      }],
      now: () => observedAt,
    }),
    new LmsCollector({
      sourceId: "lms-main",
      selectors: lmsSelectors,
      loadDocuments: async () => [{
        html: await readFile("fixtures/lms/course-notices.html", "utf8"),
        sourceUri: "https://lms.school.example/dashboard",
      }],
      now: () => observedAt,
    }),
  ];
}

test("실제 HTML, EML, LMS HTML Collector를 같은 RawItem 계약으로 수집한다", async () => {
  const results = await collectSources(actualFormatCollectors());

  assert.deepEqual(results.map((result) => ({
    sourceId: result.sourceId,
    collected: result.collected,
    errors: result.errors,
  })), [
    { sourceId: "school-site-main", collected: 1, errors: [] },
    { sourceId: "school-email-main", collected: 1, errors: [] },
    { sourceId: "lms-main", collected: 2, errors: [] },
  ]);

  for (const result of results) {
    for (const item of result.items) {
      assert.equal(item.sourceId, result.sourceId);
      assert.equal(item.sourceType, result.sourceType);
      assert.ok(item.id.length > 0);
      assert.ok(item.externalId);
      assert.match(item.uri, /^(https?|email):\/\//);
      assert.match(item.contentHash, /^[a-f0-9]{64}$/);
      assert.equal(item.observedAt, observedAt.toISOString());
    }
  }

  const email = results[1]?.items[0];
  assert.equal(email?.externalId, "<ai-hackathon-1542@school.example>");
  assert.equal(email?.metadata.messageId, email?.externalId);
});

test("반복 수집 시 Source 외부 ID, RawItem ID와 content hash가 안정적이다", async () => {
  const first = await collectSources(actualFormatCollectors());
  const second = await collectSources(actualFormatCollectors());

  assert.deepEqual(
    first.map((result) => result.items.map(identity)),
    second.map((result) => result.items.map(identity)),
  );
});

test("한 Source loader가 실패해도 다른 실제 Collector 결과와 진단을 보존한다", async () => {
  const failingEmail = new SchoolEmailCollector({
    sourceId: "school-email-failing",
    allowedSenderDomains: ["school.example"],
    loadMessages: async () => {
      throw new Error("메일 파일을 읽을 수 없습니다");
    },
  });
  const collectors = actualFormatCollectors();
  collectors.splice(1, 0, failingEmail);

  const results = await collectSources(collectors);
  const failed = results.find((result) => result.sourceId === "school-email-failing");

  assert.deepEqual(failed?.items, []);
  assert.equal(failed?.collected, 0);
  assert.deepEqual(failed?.errors, [{ message: "메일 파일을 읽을 수 없습니다" }]);
  assert.equal(
    results.filter((result) => result.sourceId !== "school-email-failing")
      .flatMap((result) => result.items).length,
    4,
  );
});

test("한 Source 내부의 잘못된 문서는 유효한 RawItem과 함께 진단된다", async () => {
  const collector = new SchoolEmailCollector({
    sourceId: "school-email-main",
    allowedSenderDomains: ["school.example"],
    loadMessages: async () => [{
      raw: "From: invalid@school.example\n\nMessage-ID 없음",
      sourceUri: "fixture://school-email/invalid.eml",
    }, {
      raw: await readFile("fixtures/school-email/ai-hackathon.eml"),
      sourceUri: "fixture://school-email/ai-hackathon.eml",
    }],
    now: () => observedAt,
  });

  const [result] = await collectSources([collector]);

  assert.equal(result?.items.length, 1);
  assert.equal(result?.errors.length, 1);
  assert.equal(result?.errors[0]?.sourceUri, "fixture://school-email/invalid.eml");
  assert.match(result?.errors[0]?.message ?? "", /Message-ID/);
});

function identity(item: { externalId?: string; id: string; contentHash: string }) {
  return {
    externalId: item.externalId,
    id: item.id,
    contentHash: item.contentHash,
  };
}
