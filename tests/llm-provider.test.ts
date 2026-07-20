import assert from "node:assert/strict";
import test from "node:test";

import { createLlmProvider } from "../apps/cli/src/runtime/llmProvider.ts";

test("createLlmProvider는 DODODO_LLM_BASE_URL이 없으면 undefined를 반환한다", () => {
  assert.equal(createLlmProvider({}), undefined);
  assert.equal(createLlmProvider({ DODODO_LLM_BASE_URL: "" }), undefined);
  assert.equal(createLlmProvider({ DODODO_LLM_BASE_URL: "   " }), undefined);
});

test("createLlmProvider는 baseUrl이 있으면 기본 모델로 Provider를 만든다", () => {
  const provider = createLlmProvider({ DODODO_LLM_BASE_URL: "http://localhost:11434" });
  assert.notEqual(provider, undefined);
});

test("createLlmProvider는 텍스트/비전 모델 환경변수를 그대로 쓴다", () => {
  const provider = createLlmProvider({
    DODODO_LLM_BASE_URL: "http://vm.example:11434",
    DODODO_TEXT_MODEL: "custom-text",
    DODODO_VISION_MODEL: "custom-vision",
  });
  assert.notEqual(provider, undefined);
});

test("createLlmProvider는 process.env를 기본값으로 쓴다(인자 생략 시)", () => {
  const original = process.env.DODODO_LLM_BASE_URL;
  try {
    delete process.env.DODODO_LLM_BASE_URL;
    assert.equal(createLlmProvider(), undefined);
  } finally {
    if (original === undefined) delete process.env.DODODO_LLM_BASE_URL;
    else process.env.DODODO_LLM_BASE_URL = original;
  }
});
