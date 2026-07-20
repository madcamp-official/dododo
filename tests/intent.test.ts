import assert from "node:assert/strict";
import test from "node:test";

import {
  answerContextQuestion,
  parseScheduleIntent,
} from "../packages/context-engine/src/index.ts";
import type { LLMJSONRequest, LLMProvider } from "../packages/context-engine/src/index.ts";
import type { ContextItem, PrivacyGateway, RawItem } from "../packages/shared/src/index.ts";

// 2026-07-18은 토요일. "이번 주 금요일"은 다가오는 금요일 7/24.
const NOW = new Date("2026-07-18T15:20:00+09:00");

test("parseScheduleIntent는 이번 주 금요일 저녁을 7/24 19:00으로 계산하고 시각 모호를 표시한다", () => {
  const result = parseScheduleIntent("이번 주 금요일 저녁에 민수랑 저녁 약속 있어", NOW);

  assert.equal(result.kind, "event_draft");
  if (result.kind !== "event_draft") return;
  assert.equal(result.startAt, "2026-07-24T19:00:00+09:00");
  assert.equal(result.ambiguousField, "time");
  assert.match(result.title, /민수/);
  assert.match(result.clarifyingQuestion, /7월 24일 19:00/);
});

test("parseScheduleIntent는 명확한 시각이면 모호 표시를 하지 않는다", () => {
  const result = parseScheduleIntent("내일 오후 3시에 팀 회의 있어", NOW);

  assert.equal(result.kind, "event_draft");
  if (result.kind !== "event_draft") return;
  assert.equal(result.startAt, "2026-07-19T15:00:00+09:00");
  assert.equal(result.ambiguousField, undefined);
});

test("parseScheduleIntent는 N월 N일 절대 날짜를 처리한다", () => {
  const result = parseScheduleIntent("7월 25일 저녁 7시에 저녁 모임 있어", NOW);

  assert.equal(result.kind, "event_draft");
  if (result.kind !== "event_draft") return;
  assert.equal(result.startAt, "2026-07-25T19:00:00+09:00");
  assert.equal(result.ambiguousField, undefined, "7시가 명시됐으므로 모호하지 않다");
});

test("parseScheduleIntent는 일정 신호가 없으면 unrecognized를 반환한다", () => {
  assert.equal(parseScheduleIntent("오늘 날씨가 좋다", NOW).kind, "unrecognized");
});

test("parseScheduleIntent는 날짜 없는 일정 문장의 글자를 요일로 오인하지 않는다", () => {
  assert.equal(parseScheduleIntent("약속 일정 하나 추가해줘", NOW).kind, "unrecognized");
  assert.equal(parseScheduleIntent("3월에 발표 약속 있어", NOW).kind, "unrecognized");
});

test("parseScheduleIntent는 요일 접미사가 있는 표현만 요일로 해석한다", () => {
  const result = parseScheduleIntent("금요일 오후 3시에 팀 회의 있어", NOW);
  assert.equal(result.kind, "event_draft");
  if (result.kind !== "event_draft") return;
  assert.equal(result.startAt, "2026-07-24T15:00:00+09:00");
});

test("parseScheduleIntent는 지난 월·일을 다음 연도 또는 다음 달로 롤오버한다", () => {
  const yearBoundary = parseScheduleIntent(
    "1월 5일 오후 3시에 팀 회의 있어",
    new Date("2026-12-31T10:00:00+09:00"),
  );
  assert.equal(yearBoundary.kind, "event_draft");
  if (yearBoundary.kind === "event_draft") {
    assert.equal(yearBoundary.startAt, "2027-01-05T15:00:00+09:00");
  }

  const monthBoundary = parseScheduleIntent(
    "5일 오후 3시에 팀 회의 있어",
    new Date("2026-07-31T10:00:00+09:00"),
  );
  assert.equal(monthBoundary.kind, "event_draft");
  if (monthBoundary.kind === "event_draft") {
    assert.equal(monthBoundary.startAt, "2026-08-05T15:00:00+09:00");
  }
});

test("parseScheduleIntent는 존재하지 않는 날짜를 확정하지 않는다", () => {
  assert.equal(parseScheduleIntent("2월 30일 오후 3시에 팀 회의 있어", NOW).kind, "unrecognized");
});

test("parseScheduleIntent는 범위를 벗어난 시각을 다음 날로 정규화하지 않는다", () => {
  for (const utterance of [
    "내일 오후 25시 99분에 팀 회의 있어",
    "내일 오전 13시에 팀 회의 있어",
    "내일 오후 0시에 팀 회의 있어",
    "내일 24시에 팀 회의 있어",
    "내일 12시 60분에 팀 회의 있어",
  ]) {
    assert.equal(parseScheduleIntent(utterance, NOW).kind, "unrecognized", utterance);
  }
});

test("parseScheduleIntent는 다음 주를 월요일 시작 달력 주로 계산한다", () => {
  const result = parseScheduleIntent("다음 주 금요일 오후 3시에 팀 회의 있어", NOW);

  assert.equal(result.kind, "event_draft");
  if (result.kind !== "event_draft") return;
  assert.equal(result.startAt, "2026-07-24T15:00:00+09:00");
});

function taskItem(overrides: Partial<ContextItem> = {}): ContextItem {
  return {
    id: "ctx-1",
    kind: "task",
    title: "운영체제 과제 보고서",
    status: "todo",
    deadline: "2026-07-19T18:00:00+09:00",
    requirements: ["보고서"],
    tags: ["task", "운영체제"],
    priority: 0,
    confidence: 0.9,
    evidenceIds: ["ev-os"],
    metadata: {},
    createdAt: "2026-07-18T00:00:00+09:00",
    updatedAt: "2026-07-18T00:00:00+09:00",
    ...overrides,
  };
}

test("answerContextQuestion은 마감이 임박한 미완료 Task를 근거와 함께 답한다", async () => {
  const items = [
    taskItem(),
    taskItem({ id: "ctx-far", title: "기말 프로젝트", deadline: "2026-08-30T18:00:00+09:00", requirements: [], evidenceIds: ["ev-far"], tags: ["task"] }),
  ];

  const provider: LLMProvider = {
    async completeJSON<T>(request: LLMJSONRequest<T>): Promise<T> {
      const value = { answer: "운영체제 과제 보고서 초안을 먼저 작성하세요. 마감이 내일입니다." };
      if (!request.validate(value)) throw new Error("invalid");
      return value;
    },
  };

  const answer = await answerContextQuestion(
    "오늘 저녁 약속 전까지 뭘 하는 게 좋아?",
    items,
    NOW,
    provider,
    passthroughPrivacyGateway,
  );

  assert.match(answer.answer, /보고서/);
  assert.ok(answer.evidenceIds.includes("ev-os"), "근거에 임박한 Task의 Evidence가 포함돼야 한다");
});

test("answerContextQuestion은 미완료 항목이 없으면 모른다고 답하고 근거를 비운다", async () => {
  const done = taskItem({ status: "done" });
  const answer = await answerContextQuestion("뭘 할까?", [done], NOW);

  assert.match(answer.answer, /찾지 못했습니다/);
  assert.deepEqual(answer.evidenceIds, []);
});

test("answerContextQuestion은 provider 없거나 실패하면 결정론적 템플릿으로 답한다", async () => {
  const withoutProvider = await answerContextQuestion("뭘 할까?", [taskItem()], NOW);
  assert.match(withoutProvider.answer, /운영체제 과제 보고서/);
  assert.deepEqual(withoutProvider.evidenceIds, ["ev-os"]);

  const failing: LLMProvider = {
    async completeJSON() {
      throw new Error("LLM 다운");
    },
  };
  const onFailure = await answerContextQuestion(
    "뭘 할까?",
    [taskItem()],
    NOW,
    failing,
    passthroughPrivacyGateway,
  );
  assert.match(onFailure.answer, /운영체제 과제 보고서/);
  assert.deepEqual(onFailure.evidenceIds, ["ev-os"]);
});

test("answerContextQuestion은 Privacy Gateway를 거친 질문과 Context만 Provider에 전달한다", async () => {
  let prompt = "";
  const provider: LLMProvider = {
    async completeJSON<T>(request: LLMJSONRequest<T>): Promise<T> {
      prompt = request.userPrompt;
      const value = { answer: "보고서를 먼저 작성하세요." };
      if (!request.validate(value)) throw new Error("invalid");
      return value;
    },
  };
  const originalQuestion = "내 번호 010-1234-5678인데 오늘 뭘 할까?";
  const originalItem = taskItem({
    title: "운영체제 과제 담당자 hong@example.com",
    requirements: ["학번 20231234 제출"],
  });
  const before = structuredClone(originalItem);
  const maskingGateway: PrivacyGateway = {
    async prepare(rawItem: RawItem) {
      const safe = structuredClone(rawItem);
      safe.content = safe.content
        .replace("010-1234-5678", "[전화번호]")
        .replace("hong@example.com", "[이메일]")
        .replace("20231234", "[학번]");
      return safe;
    },
  };

  await answerContextQuestion(originalQuestion, [originalItem], NOW, provider, maskingGateway);

  assert.match(prompt, /<safe_context_json>/);
  assert.match(prompt, /\[전화번호\]/);
  assert.match(prompt, /\[이메일\]/);
  assert.match(prompt, /\[학번\]/);
  assert.doesNotMatch(prompt, /010-1234-5678|hong@example\.com|20231234/);
  assert.equal(originalQuestion, "내 번호 010-1234-5678인데 오늘 뭘 할까?");
  assert.deepEqual(originalItem, before);
});

test("answerContextQuestion은 구체 질문과 무관한 임박 Task를 근거로 쓰지 않는다", async () => {
  let called = false;
  const provider: LLMProvider = {
    async completeJSON() {
      called = true;
      throw new Error("호출되면 안 됨");
    },
  };
  const answer = await answerContextQuestion(
    "기숙사 세탁실 운영 시간이 언제야?",
    [taskItem({ title: "기한이 지난 운영체제 과제" })],
    NOW,
    provider,
    passthroughPrivacyGateway,
  );

  assert.match(answer.answer, /찾지 못했습니다/);
  assert.deepEqual(answer.evidenceIds, []);
  assert.equal(called, false);
});

test("answerContextQuestion은 빈 LLM 답변이면 템플릿으로 폴백한다", async () => {
  const answer = await answerContextQuestion(
    "뭘 할까?",
    [taskItem()],
    NOW,
    {
      async completeJSON<T>(request: LLMJSONRequest<T>): Promise<T> {
        const value = { answer: "   " };
        if (!request.validate(value)) throw new Error("invalid");
        return value;
      },
    },
    passthroughPrivacyGateway,
  );

  assert.match(answer.answer, /운영체제 과제 보고서/);
});

const passthroughPrivacyGateway: PrivacyGateway = {
  async prepare(rawItem) {
    return structuredClone(rawItem);
  },
};
