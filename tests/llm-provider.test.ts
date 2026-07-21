import assert from "node:assert/strict";
import test from "node:test";

import { RemoteJobLLMProvider } from "../packages/context-engine/src/index.ts";
import { createLlmProvider, resolveLlmConfig } from "../apps/cli/src/runtime/llmProvider.ts";

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

test("remote-job 설정은 RemoteJobLLMProvider를 만든다", () => {
  const provider = createLlmProvider({
    DODODO_LLM_PROVIDER: "remote-job",
    DODODO_LLM_BASE_URL: "https://llm.example.test",
    DODODO_LLM_TOKEN: "device-token",
    DODODO_LLM_TIMEOUT_MS: "1200000",
  });
  assert.ok(provider instanceof RemoteJobLLMProvider);
});

test("remote-job Token이 없으면 Provider를 만들지 않고 설정 오류를 보존한다", () => {
  const env = {
    DODODO_LLM_PROVIDER: "remote-job",
    DODODO_LLM_BASE_URL: "https://llm.example.test",
  };
  assert.equal(createLlmProvider(env), undefined);
  assert.match(resolveLlmConfig(env)?.configurationError ?? "", /DODODO_LLM_TOKEN/);
});
