import assert from "node:assert/strict";
import test from "node:test";

import { RetryAwareFactExtractor } from "../apps/cli/src/runtime/retryAwareFactExtractor.ts";
import {
  LLMExtractionError,
  LLMFactExtractor,
  type LLMJSONRequest,
  type LLMProvider,
} from "../packages/context-engine/src/index.ts";
import type { RawItem } from "../packages/shared/src/index.ts";

class ThrowingLLMProvider implements LLMProvider {
  private readonly error: Error;

  constructor(error: Error) {
    this.error = error;
  }

  async completeJSON<T>(_request: LLMJSONRequest<T>): Promise<T> {
    throw this.error;
  }
}

class EmptyFactsLLMProvider implements LLMProvider {
  async completeJSON<T>(request: LLMJSONRequest<T>): Promise<T> {
    const value = { facts: [] };
    if (!request.validate(value)) throw new Error("unexpected: facts:[] should validate");
    return value;
  }
}

const rawItem: RawItem = {
  id: "raw-lms-001",
  sourceId: "lms-main",
  sourceType: "lms",
  uri: "https://lms.example/courses/os/assignments/3",
  title: "운영체제 과제 3",
  content: "과제 3은 2026년 7월 22일까지 제출합니다.",
  contentHash: "fixture-lms-001",
  observedAt: "2026-07-18T09:20:00+09:00",
  metadata: {},
};

test("RetryAwareFactExtractor는 일시적 LLM 오류(retryable_failure)를 throw로 바꾼다", async () => {
  const provider = new ThrowingLLMProvider(
    new LLMExtractionError("connect ECONNREFUSED", { category: "connection" }),
  );
  const extractor = new RetryAwareFactExtractor(new LLMFactExtractor(provider));

  await assert.rejects(extractor.extract(rawItem), /일시적 LLM 오류로 재시도가 필요합니다/);
});

test("RetryAwareFactExtractor는 영구 실패(invalid_output)는 빈 배열로 그대로 흡수한다", async () => {
  const provider = new ThrowingLLMProvider(
    new LLMExtractionError("스키마 불일치", { category: "invalid_output" }),
  );
  const extractor = new RetryAwareFactExtractor(new LLMFactExtractor(provider));

  assert.deepEqual(await extractor.extract(rawItem), []);
});

test("RetryAwareFactExtractor는 LLM이 명시적으로 사실 없음을 반환하면 빈 배열을 그대로 반환한다", async () => {
  const extractor = new RetryAwareFactExtractor(new LLMFactExtractor(new EmptyFactsLLMProvider()));

  assert.deepEqual(await extractor.extract(rawItem), []);
});
