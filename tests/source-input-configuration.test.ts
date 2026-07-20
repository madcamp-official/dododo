import assert from "node:assert/strict";
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  collectSources,
  createSourceCollectors,
  loadEmlDirectory,
  loadLmsHtmlFiles,
  validateSourceInputConfig,
  type LmsHtmlSelectors,
  type SourceInputConfig,
} from "../packages/collectors/src/index.ts";

const observedAt = new Date("2026-07-20T12:00:00+09:00");
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

test("설정으로 학교 사이트, EML 디렉터리와 LMS HTML Collector를 생성한다", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dododo-source-config-"));
  try {
    const emailDirectory = join(directory, "email");
    await mkdir(emailDirectory);
    await copyFile("fixtures/school-email/ai-hackathon.eml", join(emailDirectory, "notice.eml"));
    await writeFile(join(emailDirectory, "ignored.txt"), "수집하지 않는 파일", "utf8");

    const config: SourceInputConfig = {
      schoolSite: {
        sourceId: "school-site-configured",
        url: "https://school.example/notices",
      },
      schoolEmail: {
        sourceId: "school-email-configured",
        inputDirectory: emailDirectory,
        allowedSenderDomains: ["school.example"],
      },
      lms: {
        sourceId: "lms-configured",
        baseUrl: "https://lms.school.example/dashboard",
        inputPaths: ["fixtures/lms/course-notices.html"],
        selectors: lmsSelectors,
      },
    };
    const html = await readFile("fixtures/school-site/notices.html", "utf8");
    const collectors = createSourceCollectors(config, {
      now: () => observedAt,
      fetchImplementation: async () => new Response(html, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
    });

    const results = await collectSources(collectors);

    assert.deepEqual(results.map((result) => ({
      sourceId: result.sourceId,
      collected: result.collected,
      errorCount: result.errors.length,
    })), [
      { sourceId: "school-site-configured", collected: 1, errorCount: 0 },
      { sourceId: "school-email-configured", collected: 1, errorCount: 0 },
      { sourceId: "lms-configured", collected: 2, errorCount: 0 },
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("비활성화한 Source는 Collector를 만들거나 설정값을 검증하지 않는다", () => {
  const collectors = createSourceCollectors({
    schoolSite: { enabled: false, url: "not-a-url" },
    schoolEmail: {
      enabled: false,
      inputDirectory: "",
      allowedSenderDomains: [],
    },
    lms: {
      enabled: false,
      baseUrl: "not-a-url",
      inputPaths: [],
      selectors: { item: "", title: "" },
    },
  });

  assert.deepEqual(collectors, []);
});

test("잘못된 URL, 이메일 도메인과 LMS 입력 확장자를 생성 전에 거부한다", () => {
  assert.throws(
    () => validateSourceInputConfig({ schoolSite: { url: "file:///school/notices.html" } }),
    /HTTP 또는 HTTPS/,
  );
  assert.throws(
    () => validateSourceInputConfig({
      schoolEmail: { inputDirectory: "fixtures/school-email", allowedSenderDomains: [] },
    }),
    /하나 이상/,
  );
  assert.throws(
    () => validateSourceInputConfig({
      lms: {
        baseUrl: "https://lms.school.example/dashboard",
        inputPaths: ["fixtures/lms/notices.json"],
        selectors: lmsSelectors,
      },
    }),
    /.html 또는 .htm/,
  );
});

test("EML Loader는 디렉터리의 .eml 파일만 정렬해 읽고 빈 디렉터리를 허용한다", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dododo-eml-loader-"));
  try {
    await copyFile("fixtures/school-email/html-announcement.eml", join(directory, "b.eml"));
    await copyFile("fixtures/school-email/ai-hackathon.eml", join(directory, "a.EML"));
    await writeFile(join(directory, "note.txt"), "ignored", "utf8");

    const loaded = await loadEmlDirectory(directory);
    assert.equal(loaded.inputs.length, 2);
    assert.deepEqual(loaded.errors, []);
    assert.match(loaded.inputs[0]?.sourceUri ?? "", /a\.EML$/);

    const emptyDirectory = join(directory, "empty");
    await mkdir(emptyDirectory);
    assert.deepEqual(await loadEmlDirectory(emptyDirectory), { inputs: [], errors: [] });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("LMS Loader는 파일 하나를 읽지 못해도 나머지 HTML 입력을 보존한다", async () => {
  const missing = join(tmpdir(), "dododo-missing-lms-input.html");
  const result = await loadLmsHtmlFiles([
    "fixtures/lms/course-notices.html",
    missing,
  ]);

  assert.equal(result.inputs.length, 1);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0]?.sourceUri, missing);
});

test("설정된 입력 경로 오류는 Source ID와 함께 통합 수집 결과에 남는다", async () => {
  const missing = join(tmpdir(), "dododo-missing-email-directory");
  const [result] = await collectSources(createSourceCollectors({
    schoolEmail: {
      sourceId: "school-email-missing",
      inputDirectory: missing,
      allowedSenderDomains: ["school.example"],
    },
  }));

  assert.equal(result?.sourceId, "school-email-missing");
  assert.equal(result?.collected, 0);
  assert.equal(result?.errors.length, 1);
  assert.equal(result?.errors[0]?.sourceUri, missing);
});
