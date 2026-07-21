import assert from "node:assert/strict";
import test from "node:test";

import {
  parseScheduleIntent,
  parseScheduleIntentWithLlmFallback,
} from "../packages/context-engine/src/index.ts";
import type { LLMJSONRequest, LLMProvider } from "../packages/context-engine/src/index.ts";
import type { PrivacyGateway, RawItem } from "../packages/shared/src/index.ts";

const NOW = new Date("2026-07-18T15:20:00+09:00"); // 토요일

const passthroughPrivacyGateway: PrivacyGateway = {
  async prepare(rawItem: RawItem) {
    return structuredClone(rawItem);
  },
};

function providerReturning(values: {
  rewrite?: { rewritten: string };
  title?: { title: string };
}): LLMProvider {
  let call = 0;
  return {
    async completeJSON<T>(request: LLMJSONRequest<T>): Promise<T> {
      call += 1;
      const isRewrite = request.systemPrompt.includes("다시 쓰는");
      const value = isRewrite ? values.rewrite : values.title;
      if (value === undefined) {
        throw new Error(`예상치 못한 호출(${call}번째, ${isRewrite ? "rewrite" : "title"})`);
      }
      if (!request.validate(value)) throw new Error("invalid");
      return value;
    },
  };
}

test("provider 없으면 규칙 결과와 완전히 동일하다(회귀 없음)", async () => {
  const utterance = "이번 주 금요일 저녁에 민수랑 저녁 약속 있어";
  const ruleOnly = parseScheduleIntent(utterance, NOW);
  const withFallback = await parseScheduleIntentWithLlmFallback(utterance, NOW);

  assert.deepEqual(withFallback, ruleOnly);
});

test("규칙 파서가 이미 성공하면 날짜·시각은 그대로 두고 제목만 LLM으로 다듬는다", async () => {
  const utterance = "내일 오후 3시에 팀 회의 있어";
  const before = parseScheduleIntent(utterance, NOW);
  assert.equal(before.kind, "event_draft");

  const provider = providerReturning({ title: { title: "팀 정기 회의" } });
  const result = await parseScheduleIntentWithLlmFallback(utterance, NOW, provider, passthroughPrivacyGateway);

  assert.equal(result.kind, "event_draft");
  if (result.kind !== "event_draft") return;
  assert.equal(result.title, "팀 정기 회의");
  // 날짜·시각은 LLM이 손대지 않고 규칙 파서 결과 그대로여야 한다.
  if (before.kind === "event_draft") assert.equal(result.startAt, before.startAt);
  assert.match(result.clarifyingQuestion, /^팀 정기 회의을\(를\)/);
});

test("제목 다듬기 응답이 무효하거나 실패하면 규칙 파서의 원래 제목으로 폴백한다", async () => {
  const utterance = "내일 오후 3시에 팀 회의 있어";
  const before = parseScheduleIntent(utterance, NOW);
  assert.equal(before.kind, "event_draft");
  if (before.kind !== "event_draft") return;

  const failing: LLMProvider = {
    async completeJSON() {
      throw new Error("LLM 다운");
    },
  };
  const failed = await parseScheduleIntentWithLlmFallback(utterance, NOW, failing, passthroughPrivacyGateway);
  assert.equal(failed.kind, "event_draft");
  if (failed.kind === "event_draft") assert.equal(failed.title, before.title);

  const tooLong = providerReturning({ title: { title: "가".repeat(61) } });
  const oversized = await parseScheduleIntentWithLlmFallback(utterance, NOW, tooLong, passthroughPrivacyGateway);
  assert.equal(oversized.kind, "event_draft");
  if (oversized.kind === "event_draft") assert.equal(oversized.title, before.title);
});

test("규칙 파서가 실패하면 LLM이 표준 패턴으로 번역한 문장을 다시 규칙 파서에 넣는다", async () => {
  // "동아리 뒤풀이"는 구 SCHEDULE_SIGNAL 목록에 없어 규칙 파서 혼자서는 인식하지 못한다.
  const utterance = "금요일 저녁 7시 동아리 뒤풀이";
  assert.equal(parseScheduleIntent(utterance, NOW).kind, "unrecognized");

  const provider = providerReturning({ rewrite: { rewritten: "금요일 저녁 7시 모임" } });
  const result = await parseScheduleIntentWithLlmFallback(utterance, NOW, provider, passthroughPrivacyGateway);

  assert.equal(result.kind, "event_draft");
  if (result.kind !== "event_draft") return;
  // evidenceQuote는 LLM이 다시 쓴 문장이 아니라 사용자가 실제로 입력한 원문이어야 한다.
  assert.equal(result.evidenceQuote, utterance);
});

test("LLM 재작성 결과도 규칙 파서를 다시 통과해야 하며, 여전히 인식 불가면 unrecognized를 유지한다", async () => {
  const utterance = "asdf 아무말";
  const provider = providerReturning({ rewrite: { rewritten: "asdf 아무말" } });

  const result = await parseScheduleIntentWithLlmFallback(utterance, NOW, provider, passthroughPrivacyGateway);

  assert.equal(result.kind, "unrecognized");
});

test("재작성 응답이 지나치게 길면(패턴을 벗어난 자유 문장으로 의심) 시도하지 않는다", async () => {
  const utterance = "금요일 저녁 7시 동아리 뒤풀이";
  const provider = providerReturning({ rewrite: { rewritten: `금요일 저녁 7시 모임 ${"가".repeat(100)}` } });

  const result = await parseScheduleIntentWithLlmFallback(utterance, NOW, provider, passthroughPrivacyGateway);

  assert.equal(result.kind, "unrecognized");
});

test("Privacy Gateway를 거친 내용만 Provider에 전달한다", async () => {
  let sentPrompt = "";
  const provider: LLMProvider = {
    async completeJSON<T>(request: LLMJSONRequest<T>): Promise<T> {
      sentPrompt = request.userPrompt;
      const value = { rewritten: "내일 오후 3시 미팅" };
      if (!request.validate(value)) throw new Error("invalid");
      return value;
    },
  };
  // 실제 ChunkingPrivacyGateway(packages/privacy/src/masking.ts)는 전화번호 패턴을
  // 전역(global) 정규식으로 마스킹한다 — title-polish 프롬프트는 raw_title과
  // original 두 줄에 같은 문구가 중복될 수 있어(evidenceQuote에서 유래), 여기서도
  // replaceAll로 전부 마스킹해야 실제 동작과 같은 조건이 된다.
  const maskingGateway: PrivacyGateway = {
    async prepare(rawItem: RawItem) {
      const safe = structuredClone(rawItem);
      safe.content = safe.content.replaceAll("010-1234-5678", "[전화번호]");
      return safe;
    },
  };

  await parseScheduleIntentWithLlmFallback(
    "내 번호 010-1234-5678로 연락줘 내일 오후 3시 회의",
    NOW,
    provider,
    maskingGateway,
  );

  assert.match(sentPrompt, /\[전화번호\]/);
  assert.doesNotMatch(sentPrompt, /010-1234-5678/);
});
