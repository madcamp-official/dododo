import assert from "node:assert/strict";
import test from "node:test";

import {
  createSchoolSiteHttpLoader,
  SchoolSiteCollector,
  type SchoolSiteFetch,
} from "../packages/collectors/src/index.ts";

const url = "https://school.example/notices";
const html = `
  <article class="notice-item" data-notice-id="notice-1">
    <a class="notice-link" href="/notices/1">테스트 공지</a>
    <div class="notice-content">테스트 본문입니다.</div>
  </article>
`;

test("HTTP Loader는 HTML 응답과 요청 안전 설정을 전달한다", async () => {
  let capturedInput: string | URL | undefined;
  let capturedInit: RequestInit | undefined;
  const fakeFetch: SchoolSiteFetch = async (input, init) => {
    capturedInput = input;
    capturedInit = init;
    return htmlResponse(html);
  };
  const loadHtml = createSchoolSiteHttpLoader({
    url,
    timeoutMs: 5_000,
    userAgent: "dododo-test/1.0",
    fetchImplementation: fakeFetch,
  });

  assert.equal(await loadHtml(), html);
  assert.equal(capturedInput?.toString(), url);
  assert.equal(capturedInit?.method, "GET");
  assert.equal(capturedInit?.redirect, "follow");
  assert.ok(capturedInit?.signal instanceof AbortSignal);
  const headers = new Headers(capturedInit?.headers);
  assert.equal(headers.get("user-agent"), "dododo-test/1.0");
  assert.match(headers.get("accept") ?? "", /text\/html/);
});

test("HTTP Loader는 실패 HTTP 상태를 거부한다", async () => {
  const loadHtml = createSchoolSiteHttpLoader({
    url,
    fetchImplementation: async () => htmlResponse("Not Found", 404),
  });

  await assert.rejects(() => loadHtml(), /HTTP 404/);
});

test("HTTP Loader는 HTML이 아닌 Content-Type을 거부한다", async () => {
  const loadHtml = createSchoolSiteHttpLoader({
    url,
    fetchImplementation: async () => new Response("{}", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  });

  await assert.rejects(() => loadHtml(), /HTML이 아닌 응답/);
});

test("HTTP Loader는 Content-Length가 제한을 넘으면 본문을 읽지 않고 거부한다", async () => {
  const loadHtml = createSchoolSiteHttpLoader({
    url,
    maxResponseBytes: 10,
    fetchImplementation: async () => new Response("small", {
      status: 200,
      headers: {
        "Content-Type": "text/html",
        "Content-Length": "11",
      },
    }),
  });

  await assert.rejects(() => loadHtml(), /허용 크기\(10 bytes\)를 초과/);
});

test("HTTP Loader는 실제 UTF-8 본문 크기가 제한을 넘으면 거부한다", async () => {
  const loadHtml = createSchoolSiteHttpLoader({
    url,
    maxResponseBytes: 5,
    fetchImplementation: async () => htmlResponse("한글"),
  });

  await assert.rejects(() => loadHtml(), /허용 크기\(5 bytes\)를 초과/);
});

test("HTTP Loader는 축소된 Content-Length를 신뢰하지 않고 스트리밍 중 제한을 적용한다", async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("12345"));
      controller.enqueue(new TextEncoder().encode("67890"));
      controller.enqueue(new TextEncoder().encode("unread"));
    },
    cancel() {
      cancelled = true;
    },
  });
  const loadHtml = createSchoolSiteHttpLoader({
    url,
    maxResponseBytes: 8,
    fetchImplementation: async () => new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "text/html",
        "Content-Length": "2",
      },
    }),
  });

  await assert.rejects(() => loadHtml(), /허용 크기\(8 bytes\)를 초과/);
  assert.equal(cancelled, true);
});

test("HTTP Loader는 Content-Length 없이도 제한을 적용한다", async () => {
  const loadHtml = createSchoolSiteHttpLoader({
    url,
    maxResponseBytes: 5,
    fetchImplementation: async () => htmlResponse("123456"),
  });

  await assert.rejects(() => loadHtml(), /허용 크기\(5 bytes\)를 초과/);
});

test("HTTP Loader는 UTF-8 문자가 여러 청크로 나뉘어도 정상 디코딩한다", async () => {
  const encoded = new TextEncoder().encode("한글 HTML");
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoded.slice(0, 1));
      controller.enqueue(encoded.slice(1, 4));
      controller.enqueue(encoded.slice(4));
      controller.close();
    },
  });
  const loadHtml = createSchoolSiteHttpLoader({
    url,
    maxResponseBytes: encoded.byteLength,
    fetchImplementation: async () => new Response(body, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    }),
  });

  assert.equal(await loadHtml(), "한글 HTML");
});

test("HTTP Loader는 네트워크 오류를 URL과 함께 보고한다", async () => {
  const loadHtml = createSchoolSiteHttpLoader({
    url,
    fetchImplementation: async () => {
      throw new Error("connection refused");
    },
  });

  await assert.rejects(() => loadHtml(), /school\.example\/notices.*connection refused/);
});

test("HTTP Loader는 잘못된 URL과 설정을 생성 시점에 거부한다", () => {
  assert.throws(
    () => createSchoolSiteHttpLoader({ url: "file:///tmp/notices.html" }),
    /HTTP 또는 HTTPS/,
  );
  assert.throws(
    () => createSchoolSiteHttpLoader({ url, timeoutMs: 0 }),
    /timeoutMs는 0보다 큰 정수/,
  );
});

test("HTTP Loader와 SchoolSiteCollector를 연결해 RawItem을 생성한다", async () => {
  const loadHtml = createSchoolSiteHttpLoader({
    url,
    fetchImplementation: async () => htmlResponse(html),
  });
  const collector = new SchoolSiteCollector({
    sourceId: "school-site-main",
    baseUrl: "https://school.example/",
    loadHtml,
    now: () => new Date("2026-07-18T12:00:00+09:00"),
  });

  const [item] = await collector.sync();

  assert.equal(item?.externalId, "notice-1");
  assert.equal(item?.uri, "https://school.example/notices/1");
  assert.equal(item?.content, "테스트 본문입니다.");
});

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
