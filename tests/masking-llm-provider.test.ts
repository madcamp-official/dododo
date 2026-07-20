import assert from "node:assert/strict";
import test from "node:test";

import { MaskingLLMProvider } from "../apps/cli/src/runtime/maskingLlmProvider.ts";
import { ChunkingPrivacyGateway } from "../packages/privacy/src/index.ts";
import type { LLMJSONRequest, LLMProvider } from "../packages/context-engine/src/index.ts";

class RecordingLLMProvider implements LLMProvider {
  lastUserPrompt: string | undefined;

  async completeJSON<T>(request: LLMJSONRequest<T>): Promise<T> {
    this.lastUserPrompt = request.userPrompt;
    const value = { action: "확인하세요.", reason: "테스트" };
    if (!request.validate(value)) throw new Error("unexpected: fixture value should validate");
    return value;
  }
}

test("MaskingLLMProvider는 Provider에 보내기 전 userPrompt를 마스킹한다", async () => {
  const inner = new RecordingLLMProvider();
  const gateway = new ChunkingPrivacyGateway({ allowedSources: ["conversation"] });
  const provider = new MaskingLLMProvider(inner, gateway);

  await provider.completeJSON({
    modelKind: "text",
    systemPrompt: "system",
    userPrompt: "title: 민수(minsu@school.example)랑 저녁 약속",
    schema: { type: "object", required: [], properties: {} },
    validate: (value): value is unknown => value !== undefined,
  });

  assert.ok(inner.lastUserPrompt !== undefined);
  assert.doesNotMatch(inner.lastUserPrompt!, /minsu@school\.example/);
  assert.match(inner.lastUserPrompt!, /\[이메일\]/);
});

test("MaskingLLMProvider는 privacyGateway가 conversation을 막으면 그대로 실패한다", async () => {
  const inner = new RecordingLLMProvider();
  const gateway = new ChunkingPrivacyGateway({ allowedSources: [] });
  const provider = new MaskingLLMProvider(inner, gateway);

  await assert.rejects(provider.completeJSON({
    modelKind: "text",
    systemPrompt: "system",
    userPrompt: "hello",
    schema: { type: "object", required: [], properties: {} },
    validate: (value): value is unknown => value !== undefined,
  }));
});
