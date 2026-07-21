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

test("parseScheduleIntent는 시각 뒤에 붙은 조사를 제목에 남기지 않는다", () => {
  const result = parseScheduleIntent("내일 3시에 치과 예약", NOW);
  assert.equal(result.kind, "event_draft");
  if (result.kind !== "event_draft") return;
  assert.equal(result.title, "치과 예약");
});

test("parseScheduleIntent는 슬래시 날짜(M/D)를 처리한다", () => {
  const result = parseScheduleIntent("8/15에 스터디 모임", NOW);
  assert.equal(result.kind, "event_draft");
  if (result.kind !== "event_draft") return;
  assert.equal(result.startAt, "2026-08-15T09:00:00+09:00");
  assert.equal(result.ambiguousField, "time");
});

test("parseScheduleIntent는 ISO 날짜와 콜론 시각을 처리하고 모호하지 않다고 표시한다", () => {
  const result = parseScheduleIntent("2026-08-01 14:00 세미나", NOW);
  assert.equal(result.kind, "event_draft");
  if (result.kind !== "event_draft") return;
  assert.equal(result.startAt, "2026-08-01T14:00:00+09:00");
  assert.equal(result.ambiguousField, undefined);
});

test("parseScheduleIntent는 다음 달 N일을 처리하고 연도가 바뀌면 롤오버한다", () => {
  const result = parseScheduleIntent("다음달 3일 워크숍", NOW);
  assert.equal(result.kind, "event_draft");
  if (result.kind !== "event_draft") return;
  assert.equal(result.startAt, "2026-08-03T09:00:00+09:00");

  const yearBoundary = parseScheduleIntent(
    "다음달 3일 워크숍",
    new Date("2026-12-20T10:00:00+09:00"),
  );
  assert.equal(yearBoundary.kind, "event_draft");
  if (yearBoundary.kind === "event_draft") {
    assert.equal(yearBoundary.startAt, "2027-01-03T09:00:00+09:00");
  }
});

test("parseScheduleIntent는 주말을 다가오는 토요일로 계산한다", () => {
  // NOW는 토요일(2026-07-18)이라 오늘이 곧 주말이다.
  const result = parseScheduleIntent("주말에 등산 가기로 했어", NOW);
  assert.equal(result.kind, "event_draft");
  if (result.kind !== "event_draft") return;
  assert.equal(result.startAt.slice(0, 10), "2026-07-18");
});

test("parseScheduleIntent는 '반'을 30분으로, 구어체 요일(욜)과 담주를 처리한다", () => {
  const half = parseScheduleIntent("26일 2시 반에 상담", NOW);
  assert.equal(half.kind, "event_draft");
  if (half.kind === "event_draft") assert.equal(half.startAt, "2026-07-26T02:30:00+09:00");

  const colloquialWeekday = parseScheduleIntent("화욜 저녁 약속", NOW);
  assert.equal(colloquialWeekday.kind, "event_draft");
  if (colloquialWeekday.kind === "event_draft") {
    assert.equal(colloquialWeekday.startAt.slice(0, 10), "2026-07-21");
  }

  const damju = parseScheduleIntent("담주 목요일 발표 준비", NOW);
  assert.equal(damju.kind, "event_draft");
  if (damju.kind === "event_draft") assert.equal(damju.startAt.slice(0, 10), "2026-07-23");
});

test("parseScheduleIntent는 '부터~까지' 범위를 endAt으로 채운다", () => {
  const result = parseScheduleIntent("내일 오후 2시부터 4시까지 스터디", NOW);
  assert.equal(result.kind, "event_draft");
  if (result.kind !== "event_draft") return;
  assert.equal(result.startAt, "2026-07-19T14:00:00+09:00");
  assert.equal(result.endAt, "2026-07-19T16:00:00+09:00");
  assert.equal(result.title, "스터디");
  assert.match(result.clarifyingQuestion, /14:00~16:00/);
});

test("parseScheduleIntent는 '까지' 없이 '~'만 쓴 범위와 콜론(HH:MM) 범위도 endAt으로 채운다", () => {
  // "까지"를 필수로 두면 이 두 흔한 표현이 조용히 시작 시각만으로 축소된다
  // (PR #49 리뷰, doyeonid 지적 — "일반적인 시간 범위 입력의 종료 시각을 조용히 버립니다").
  const tilde = parseScheduleIntent("내일 오후 2시~4시 스터디", NOW);
  assert.equal(tilde.kind, "event_draft");
  if (tilde.kind === "event_draft") {
    assert.equal(tilde.startAt, "2026-07-19T14:00:00+09:00");
    assert.equal(tilde.endAt, "2026-07-19T16:00:00+09:00");
  }

  const colon = parseScheduleIntent("내일 14:00~16:00 회의", NOW);
  assert.equal(colon.kind, "event_draft");
  if (colon.kind === "event_draft") {
    assert.equal(colon.startAt, "2026-07-19T14:00:00+09:00");
    assert.equal(colon.endAt, "2026-07-19T16:00:00+09:00");
  }

  const noKkaji = parseScheduleIntent("내일 2시부터 4시 스터디", NOW);
  assert.equal(noKkaji.kind, "event_draft");
  if (noKkaji.kind === "event_draft") {
    assert.equal(noKkaji.startAt, "2026-07-19T02:00:00+09:00");
    assert.equal(noKkaji.endAt, "2026-07-19T04:00:00+09:00");
  }
});

test("parseScheduleIntent는 끝이 시작보다 빠른 범위를 무효로 보고 시작 시각만으로 축소하지 않는다", () => {
  // 사용자가 명시한 "2시까지"를 조용히 버리고 시작 시각(4시)만 쓰는 event_draft를
  // 만들면 안 된다 — 해석할 수 없는 범위는 unrecognized로 거부한다(PR #49 리뷰).
  const result = parseScheduleIntent("내일 오후 4시부터 2시까지 스터디", NOW);
  assert.equal(result.kind, "unrecognized");

  // "까지" 없는 형태와 콜론 형태에도 같은 무효 판정이 적용돼야 한다 — 형식만 새로
  // 지원하고 검증은 빼먹으면 새 경로에서 같은 버그가 재발한다.
  assert.equal(parseScheduleIntent("내일 오후 4시~2시 스터디", NOW).kind, "unrecognized");
  assert.equal(parseScheduleIntent("내일 16:00~14:00 스터디", NOW).kind, "unrecognized");
});

test("parseScheduleIntent는 '새벽'을 시간대 단어로 인식해 자정을 넘는 범위를 거부한다", () => {
  // "새벽"이 메리디엠 목록에 없으면 TIME_RANGE 자체가 매치되지 않아 "범위 없음"으로
  // 오판되고, resolveTime()이 "밤 11시"만 골라 23:00 단일 일정으로(제목도 "새벽
  // 1시까지 통화"로 깨진 채) 저장 확인이 떠 버렸다(PR #49 리뷰, dotori235 지적).
  const overnight = parseScheduleIntent("밤 11시부터 새벽 1시까지 통화", NOW);
  assert.equal(overnight.kind, "unrecognized");

  // 범위가 아닌 단일 시각으로 쓰일 때도 "새벽"이 시각으로 인식돼야 하고(0~5시대는
  // 오전/오후 변환이 필요 없다), 제목에서도 깨끗이 걷어내져야 한다.
  const single = parseScheduleIntent("모레 새벽 4시에 상담", NOW);
  assert.equal(single.kind, "event_draft");
  if (single.kind !== "event_draft") return;
  assert.equal(single.startAt, "2026-07-20T04:00:00+09:00");
  assert.equal(single.title, "상담");
});

test("parseScheduleIntent는 날짜 표현이 없어도 명시적 시각이 있으면 오늘로 보되, 이미 지난 시각이면 확인을 받는다", () => {
  const result = parseScheduleIntent("카페에서 3시에 민수랑 미팅", NOW);
  assert.equal(result.kind, "event_draft");
  if (result.kind !== "event_draft") return;
  assert.equal(result.startAt.slice(0, 10), "2026-07-18");
  assert.match(result.title, /민수/);
  // NOW가 15:20이라 비-meridiem "3시"(03:00)는 이미 지난 시각이다 — 확신도와 무관하게
  // 확인을 받아야 한다(PR #49 리뷰, "이따 6시" 사례와 같은 근본 원인).
  assert.equal(result.ambiguousField, "time");
  assert.match(result.clarifyingQuestion, /이미 지난 시각/);
});

test("parseScheduleIntent는 날짜 표현이 무효하면(2월 30일) 오늘로 대체하지 않는다", () => {
  const result = parseScheduleIntent("2월 30일 오후 3시에 팀 회의 있어", NOW);
  assert.equal(result.kind, "unrecognized");
});

test("parseScheduleIntent는 상대 시간 오프셋(N분/시간 뒤)을 now 기준으로 계산한다", () => {
  const result = parseScheduleIntent("30분 뒤에 전화", NOW);
  assert.equal(result.kind, "event_draft");
  if (result.kind !== "event_draft") return;
  assert.equal(result.startAt, "2026-07-18T15:50:00+09:00");
  assert.equal(result.ambiguousField, undefined);
});

test("parseScheduleIntent는 막연한 상대 표현(이따)을 2시간 뒤 모호 시각으로 처리한다", () => {
  const result = parseScheduleIntent("이따 형이랑 밥", NOW);
  assert.equal(result.kind, "event_draft");
  if (result.kind !== "event_draft") return;
  assert.equal(result.startAt, "2026-07-18T17:20:00+09:00");
  assert.equal(result.ambiguousField, "time");
});

test("parseScheduleIntent는 막연한 상대 표현 뒤에 명시적 시각이 있으면 그 시각을 우선하되, 이미 지났으면 확인을 받는다", () => {
  const result = parseScheduleIntent("이따 6시에 형이랑 밥", NOW);
  assert.equal(result.kind, "event_draft");
  if (result.kind !== "event_draft") return;
  // "이따"는 today로만 쓰이고, 실제 시각은 명시된 6시(비-meridiem이라 06:00)를 따른다 —
  // +2시간 기본 오프셋(17:20)으로 덮어써지지 않는다. 다만 NOW(15:20) 기준 06:00은
  // 이미 지난 시각이라 "이따"(미래 의도)와 모순되므로 확인 없이 확정하지 않는다
  // (PR #49 리뷰, doyeonid 지적 — 과거 시각을 정상 결과로 고정하면 안 됨).
  assert.equal(result.startAt, "2026-07-18T06:00:00+09:00");
  assert.equal(result.ambiguousField, "time");
  assert.match(result.clarifyingQuestion, /이미 지난 시각/);
});

test("parseScheduleIntent는 과거 표현이 있으면 미래 일정으로 확정하지 않는다", () => {
  assert.equal(parseScheduleIntent("어제 3시에 회의했어", NOW).kind, "unrecognized");
  assert.equal(parseScheduleIntent("지난주 금요일에 미팅 있었어", NOW).kind, "unrecognized");
});

test("parseScheduleIntent는 반복 신호가 있으면 확인 문구에 경고를 남기고 1회성으로 저장한다", () => {
  const result = parseScheduleIntent("매주 월요일 10시 랩미팅", NOW);
  assert.equal(result.kind, "event_draft");
  if (result.kind !== "event_draft") return;
  assert.equal(result.title, "랩미팅");
  assert.match(result.clarifyingQuestion, /반복 일정은 아직 지원하지 않아 이번 한 번만 저장/);
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
