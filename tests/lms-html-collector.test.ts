import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  LmsCollector,
  type LmsHtmlInput,
  type LmsHtmlSelectors,
} from "../packages/collectors/src/index.ts";
import {
  openRawItemDatabase,
  RawItemSyncService,
  SQLiteRawItemRepository,
} from "../packages/storage/src/index.ts";

const selectors: LmsHtmlSelectors = {
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

async function fixture(name: string): Promise<LmsHtmlInput> {
  return {
    html: await readFile(new URL(`../fixtures/lms/${name}`, import.meta.url), "utf8"),
    sourceUri: "https://lms.school.example/dashboard",
  };
}

function collector(
  loadDocuments: () => Promise<LmsHtmlInput[]>,
  overrides: Partial<ConstructorParameters<typeof LmsCollector>[0]> = {},
): LmsCollector {
  return new LmsCollector({
    sourceId: "lms-school",
    selectors,
    loadDocuments,
    now: () => new Date("2026-07-18T12:00:00+09:00"),
    ...overrides,
  });
}

test("LMS HTML에서 항목 ID, 과목, 유형, 본문, 마감과 원본 URL을 추출한다", async () => {
  const source = await fixture("course-notices.html");
  const items = await collector(async () => [source]).sync();

  assert.equal(items.length, 2);
  assert.equal(items[0]?.externalId, "assignment-2");
  assert.equal(items[0]?.title, "과제 2: 프로세스 스케줄러 구현");
  assert.match(items[0]?.content ?? "", /Round Robin/);
  assert.equal(items[0]?.uri, "https://lms.school.example/courses/os/notices/assignment-2");
  assert.deepEqual(items[0]?.metadata, {
    official: true,
    course: "운영체제",
    category: "과제",
    publishedAt: "2026-07-17T09:00:00+09:00",
    dueAt: "2026-07-23T23:59:00+09:00",
  });
});

test("같은 LMS 항목은 수집 시마다 동일한 RawItem ID를 사용한다", async () => {
  const source = await fixture("course-notices.html");
  const first = await collector(async () => [source]).sync();
  const second = await collector(async () => [source]).sync();

  assert.equal(first[0]?.id, second[0]?.id);
  assert.equal(first[0]?.contentHash, second[0]?.contentHash);
});

test("잘못된 LMS 항목 하나를 격리하고 다음 항목 수집을 계속한다", async () => {
  const source = await fixture("partially-invalid.html");
  const instance = collector(async () => [source]);

  const items = await instance.sync();

  assert.equal(items.length, 1);
  assert.equal(items[0]?.externalId, "quiz-1");
  assert.equal(instance.listErrors().length, 1);
  assert.match(instance.listErrors()[0]?.message ?? "", /제목/);
  assert.equal(instance.listErrors()[0]?.itemIndex, 0);
});

test("LMS 상세 링크는 HTTP 또는 HTTPS만 허용하고 위험한 항목을 격리한다", async () => {
  const input = {
    html: `
      <article class="notice" data-item-id="unsafe-script">
        <h2 class="title">Script 링크</h2>
        <a class="detail" href="javascript:alert('unsafe')">상세</a>
      </article>
      <article class="notice" data-item-id="unsafe-data">
        <h2 class="title">Data 링크</h2>
        <a class="detail" href="data:text/html,unsafe">상세</a>
      </article>
      <article class="notice" data-item-id="unsafe-file">
        <h2 class="title">File 링크</h2>
        <a class="detail" href="file:///etc/passwd">상세</a>
      </article>
      <article class="notice" data-item-id="safe-item">
        <h2 class="title">정상 링크</h2>
        <a class="detail" href="/courses/os/notices/safe">상세</a>
      </article>
    `,
    sourceUri: "https://lms.school.example/dashboard",
  };
  const instance = collector(async () => [input]);

  const items = await instance.sync();

  assert.equal(items.length, 1);
  assert.equal(items[0]?.externalId, "safe-item");
  assert.equal(items[0]?.uri, "https://lms.school.example/courses/os/notices/safe");
  assert.deepEqual(instance.listErrors().map((error) => error.itemIndex), [0, 1, 2]);
  for (const error of instance.listErrors()) {
    assert.match(error.message, /HTTP 또는 HTTPS/);
  }
});

test("선택자와 일치하는 항목이 없는 문서 오류를 격리한다", async () => {
  const input = {
    html: "<html><body><p>점검 중입니다.</p></body></html>",
    sourceUri: "https://lms.school.example/maintenance",
  };
  const instance = collector(async () => [input]);

  assert.deepEqual(await instance.sync(), []);
  assert.match(instance.listErrors()[0]?.message ?? "", /선택자/);
});

test("허용 크기를 넘는 LMS HTML은 파싱 전에 제외한다", async () => {
  const input = {
    html: "<article class=\"notice\">too large</article>",
    sourceUri: "https://lms.school.example/large",
  };
  const instance = collector(async () => [input], { maxDocumentBytes: 10 });

  assert.deepEqual(await instance.sync(), []);
  assert.match(instance.listErrors()[0]?.message ?? "", /초과/);
});

test("LMS 공지 수정은 SQLite에서 created, skipped, updated로 판정된다", async () => {
  const source = await fixture("course-notices.html");
  let current = source;
  const instance = collector(async () => [current]);
  const database = openRawItemDatabase();

  try {
    const service = new RawItemSyncService(new SQLiteRawItemRepository(database));

    const created = await service.sync(await instance.sync());
    const skipped = await service.sync(await instance.sync());
    current = {
      ...source,
      html: source.html.replace(
        "2026-07-23T23:59:00+09:00",
        "2026-07-24T23:59:00+09:00",
      ),
    };
    const updated = await service.sync(await instance.sync());

    assert.deepEqual(
      [created.created, created.updated, created.skipped],
      [2, 0, 0],
    );
    assert.deepEqual(
      [skipped.created, skipped.updated, skipped.skipped],
      [0, 0, 2],
    );
    assert.deepEqual(
      [updated.created, updated.updated, updated.skipped],
      [0, 1, 1],
    );
  } finally {
    database.close();
  }
});
