import assert from "node:assert/strict";
import test from "node:test";

import {
  isRetryableCategory,
  LLMExtractionError,
  LLMFactExtractor,
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

test("isRetryableCategory는 일시적 실패만 재시도 대상으로 본다", () => {
  assert.equal(isRetryableCategory("connection"), true);
  assert.equal(isRetryableCategory("timeout"), true);
  assert.equal(isRetryableCategory("server_error"), true);
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
