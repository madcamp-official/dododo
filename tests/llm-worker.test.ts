import assert from "node:assert/strict";
import test from "node:test";

import {
  isRetryableCategory,
  LLMExtractionError,
  LLMFactExtractor,
  OllamaProvider,
} from "../packages/context-engine/src/index.ts";
import type { LLMJSONRequest, LLMProvider } from "../packages/context-engine/src/index.ts";
import type { RawItem } from "../packages/shared/src/index.ts";

const rawItem: RawItem = {
  id: "raw-lms-1",
  sourceId: "lms-main",
  sourceType: "lms",
  uri: "https://lms.example/os/3",
  title: "운영체제 과제 3",
  content: "과제 3은 2026년 7월 22일까지 제출합니다.",
  contentHash: "hash-1",
  observedAt: "2026-07-18T09:00:00+09:00",
  metadata: {},
};

function throwing(error: unknown): LLMProvider {
  return {
    async completeJSON() {
      throw error;
    },
  };
}

function returning(value: unknown): LLMProvider {
  return {
    async completeJSON<T>(request: LLMJSONRequest<T>): Promise<T> {
      if (!request.validate(value)) throw new Error("invalid");
      return value;
    },
  };
}

const providerRequest: LLMJSONRequest<{ facts: unknown[] }> = {
  modelKind: "text",
  systemPrompt: "system",
  userPrompt: "user",
  schema: {
    type: "object",
    required: ["facts"],
    properties: { facts: { type: "array", items: { type: "string" } } },
  },
  validate(value): value is { facts: unknown[] } {
    return typeof value === "object" && value !== null && "facts" in value && Array.isArray(value.facts);
  },
};

function createProvider(defaultTimeoutMs?: number): OllamaProvider {
  return new OllamaProvider({
    baseUrl: "http://ollama.test",
    textModel: "text-model",
    visionModel: "vision-model",
    ...(defaultTimeoutMs === undefined ? {} : { defaultTimeoutMs }),
  });
}

async function withMockFetch(mock: typeof fetch, run: () => Promise<void>): Promise<void> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock;
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("isRetryableCategory는 일시적 실패만 재시도 대상으로 본다", () => {
  assert.equal(isRetryableCategory("connection"), true);
  assert.equal(isRetryableCategory("timeout"), true);
  assert.equal(isRetryableCategory("server_error"), true);
  assert.equal(isRetryableCategory("rate_limited"), true);
  assert.equal(isRetryableCategory("invalid_output"), false);
  assert.equal(isRetryableCategory("client_error"), false);
  assert.equal(isRetryableCategory("no_content"), false);
});

test("LLMExtractionError.retryable은 category와 일치한다", () => {
  assert.equal(new LLMExtractionError("x", { category: "timeout" }).retryable, true);
  assert.equal(new LLMExtractionError("x", { category: "invalid_output" }).retryable, false);
  assert.equal(new LLMExtractionError("x").category, "unknown");
});

test("extractWithStatus는 재시도 가능한 실패를 retryable_failure로 구분한다", async () => {
  const extractor = new LLMFactExtractor(
    throwing(new LLMExtractionError("서버 연결 실패", { category: "connection" })),
  );
  const outcome = await extractor.extractWithStatus(rawItem);

  assert.equal(outcome.status, "retryable_failure");
  assert.equal(outcome.facts.length, 0);
  assert.equal(outcome.error?.retryable, true);
});

test("extractWithStatus는 무효 출력을 invalid_output(영구 실패)로 구분한다", async () => {
  const extractor = new LLMFactExtractor(
    throwing(new LLMExtractionError("Schema 불일치", { category: "invalid_output" })),
  );
  const outcome = await extractor.extractWithStatus(rawItem);

  assert.equal(outcome.status, "invalid_output");
  assert.equal(outcome.error?.retryable, false);
});

test("extractWithStatus는 검증은 통과했지만 Fact가 없으면 no_facts로 구분한다", async () => {
  const extractor = new LLMFactExtractor(returning({ facts: [] }));
  const outcome = await extractor.extractWithStatus(rawItem);

  assert.equal(outcome.status, "no_facts");
  assert.equal(outcome.error, undefined);
});

test("extractWithStatus는 모든 Evidence가 원문 검증에 실패하면 invalid_output으로 구분한다", async () => {
  const extractor = new LLMFactExtractor(returning({
    facts: [{
      kind: "deadline",
      subject: "운영체제 과제 3",
      value: "제출",
      confidence: 0.9,
      evidenceText: "원문에 존재하지 않는 문장",
    }],
  }));
  const outcome = await extractor.extractWithStatus(rawItem);

  assert.equal(outcome.status, "invalid_output");
  assert.deepEqual(outcome.facts, []);
  assert.equal(outcome.error?.category, "invalid_output");
  assert.equal(outcome.error?.rawItemId, rawItem.id);
});

test("extractWithStatus는 일부 Evidence만 실패하면 유효한 Fact를 보존한다", async () => {
  const extractor = new LLMFactExtractor(returning({
    facts: [
      {
        kind: "deadline",
        subject: "운영체제 과제 3",
        value: "제출",
        confidence: 0.9,
        evidenceText: "과제 3은 2026년 7월 22일까지 제출합니다.",
      },
      {
        kind: "note",
        subject: "근거 없는 내용",
        value: "무효",
        confidence: 0.5,
        evidenceText: "원문에 존재하지 않는 문장",
      },
    ],
  }));
  const outcome = await extractor.extractWithStatus(rawItem);

  assert.equal(outcome.status, "success");
  assert.equal(outcome.facts.length, 1);
  assert.equal(outcome.facts[0]?.subject, "운영체제 과제 3");
});

test("extractWithStatus는 Fact를 추출하면 success를 반환한다", async () => {
  const extractor = new LLMFactExtractor(returning({
    facts: [{
      kind: "deadline",
      subject: "운영체제 과제 3",
      value: "제출",
      eventTime: "2026-07-22T23:59:00+09:00",
      confidence: 0.9,
      evidenceText: "과제 3은 2026년 7월 22일까지 제출합니다.",
    }],
  }));
  const outcome = await extractor.extractWithStatus(rawItem);

  assert.equal(outcome.status, "success");
  assert.equal(outcome.facts.length, 1);
});

test("extract()는 상태와 무관하게 Fact 배열만 반환해 기존 계약을 유지한다", async () => {
  const failing = new LLMFactExtractor(throwing(new LLMExtractionError("x", { category: "timeout" })));
  assert.deepEqual(await failing.extract(rawItem), []);
});

test("OllamaProvider는 잘못된 기본 timeout 설정을 비재시도 오류로 거부한다", () => {
  for (const timeout of [-1, Number.NaN, 1.5, 2_147_483_648]) {
    assert.throws(
      () => createProvider(timeout),
      (error) => error instanceof LLMExtractionError
        && error.category === "client_error"
        && error.retryable === false,
    );
  }
});

test("OllamaProvider는 잘못된 요청별 timeout을 호출 전에 비재시도 오류로 거부한다", async () => {
  let fetchCount = 0;
  await withMockFetch(async () => {
    fetchCount += 1;
    return new Response(JSON.stringify({ message: { content: '{"facts":[]}' } }));
  }, async () => {
    for (const timeoutMs of [-1, Number.NaN, 1.5]) {
      await assert.rejects(
        createProvider().completeJSON({ ...providerRequest, timeoutMs }),
        (error) => error instanceof LLMExtractionError
          && error.category === "client_error"
          && error.retryable === false,
      );
    }
  });
  assert.equal(fetchCount, 0);
});

test("OllamaProvider는 408·429·5xx에서 generate 폴백 없이 재시도 오류를 반환한다", async () => {
  const cases = [
    { status: 408, category: "timeout" },
    { status: 429, category: "rate_limited" },
    { status: 503, category: "server_error" },
  ] as const;

  for (const expected of cases) {
    const paths: string[] = [];
    await withMockFetch(async (input) => {
      paths.push(String(input));
      return new Response("error", { status: expected.status });
    }, async () => {
      await assert.rejects(
        createProvider().completeJSON(providerRequest),
        (error) => error instanceof LLMExtractionError
          && error.category === expected.category
          && error.retryable === true,
      );
    });
    assert.equal(paths.length, 1);
    assert.equal(paths[0]?.endsWith("/api/chat"), true);
  }
});

test("OllamaProvider는 Schema 미지원 가능성이 있는 400에서 generate로 폴백한다", async () => {
  const paths: string[] = [];
  await withMockFetch(async (input) => {
    const path = String(input);
    paths.push(path);
    if (path.endsWith("/api/chat")) return new Response("unsupported schema", { status: 400 });
    return new Response(JSON.stringify({ response: '{"facts":[]}' }));
  }, async () => {
    const result = await createProvider().completeJSON(providerRequest);
    assert.deepEqual(result, { facts: [] });
  });
  assert.deepEqual(paths, ["http://ollama.test/api/chat", "http://ollama.test/api/generate"]);
});
