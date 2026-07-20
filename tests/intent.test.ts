import assert from "node:assert/strict";
import test from "node:test";

import {
  answerContextQuestion,
  parseScheduleIntent,
} from "../packages/context-engine/src/index.ts";
import type { LLMJSONRequest, LLMProvider } from "../packages/context-engine/src/index.ts";
import type { ContextItem } from "../packages/shared/src/index.ts";

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

  const answer = await answerContextQuestion("오늘 저녁 약속 전까지 뭘 하는 게 좋아?", items, NOW, provider);

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
  const onFailure = await answerContextQuestion("뭘 할까?", [taskItem()], NOW, failing);
  assert.match(onFailure.answer, /운영체제 과제 보고서/);
  assert.deepEqual(onFailure.evidenceIds, ["ev-os"]);
});
