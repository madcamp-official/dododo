import assert from "node:assert/strict";
import test from "node:test";

import {
  adaptScreenFixtureToRawItem,
  computePriority,
  generateScreenAdvice,
  linkActivityToContext,
  relevanceScore,
} from "../packages/context-engine/src/index.ts";
import type { LLMJSONRequest, LLMProvider } from "../packages/context-engine/src/index.ts";
import type {
  ContextItem,
  PrivacyGateway,
  RawItem,
  UserProfile,
} from "../packages/shared/src/index.ts";

function fixedProvider(value: unknown): LLMProvider {
  return {
    async completeJSON<T>(request: LLMJSONRequest<T>): Promise<T> {
      if (!request.validate(value)) throw new Error("invalid");
      return value;
    },
  };
}

const failingProvider: LLMProvider = {
  async completeJSON() {
    throw new Error("LLM 서버 다운");
  },
};

function osTask(overrides: Partial<ContextItem> = {}): ContextItem {
  return {
    id: "ctx-os",
    kind: "task",
    title: "운영체제 시험 대비",
    status: "new",
    deadline: "2026-07-21T18:00:00+09:00",
    requirements: ["스케줄링 정리"],
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

const screenFixture = {
  observedAt: "2026-07-18T15:20:00+09:00",
  applicationHint: "PDF Viewer",
  activity: "운영체제 교재의 프로세스 스케줄링 단원을 공부 중",
  relatedTaskCandidate: "운영체제 시험 대비",
  confidence: 0.82,
};

const NOW = new Date("2026-07-18T15:20:00+09:00");

test("adaptScreenFixtureToRawItem은 screen RawItem으로 변환하고 재현 가능한 id를 만든다", () => {
  const a = adaptScreenFixtureToRawItem(screenFixture);
  const b = adaptScreenFixtureToRawItem(screenFixture);

  assert.equal(a.sourceType, "screen");
  assert.equal(a.metadata.confidence, 0.82);
  assert.equal(a.id, b.id, "같은 입력은 같은 id");
});

test("linkActivityToContext는 화면 활동을 관련 Task와 연결한다", () => {
  const raw = adaptScreenFixtureToRawItem(screenFixture);
  const items = [osTask(), osTask({ id: "ctx-eng", title: "영어 에세이 제출", tags: ["task"], evidenceIds: ["ev-e"] })];

  const link = linkActivityToContext(raw, items, NOW);
  assert.equal(link?.item.id, "ctx-os");
  assert.ok(link!.relevance > 0 && link!.relevance <= 15);
});

test("linkActivityToContext는 확신도가 낮으면 연결하지 않는다", () => {
  const raw = adaptScreenFixtureToRawItem({ ...screenFixture, confidence: 0.4 });
  assert.equal(linkActivityToContext(raw, [osTask()], NOW), undefined);
});

test("linkActivityToContext는 유사한 항목이 없으면 연결하지 않는다", () => {
  const raw = adaptScreenFixtureToRawItem(screenFixture);
  const unrelated = osTask({ id: "ctx-x", title: "동아리 회비 납부", tags: ["task"], evidenceIds: ["ev-x"] });
  assert.equal(linkActivityToContext(raw, [unrelated], NOW), undefined);
});

test("linkActivityToContext는 완료된 최선 매치 대신 활성 차선 Task를 선택한다", () => {
  const raw = adaptScreenFixtureToRawItem(screenFixture);
  const doneBest = osTask({ id: "ctx-done", status: "done" });
  const activeSecond = osTask({
    id: "ctx-active",
    title: "운영체제 시험 대비 계획",
    evidenceIds: ["ev-active"],
  });

  const link = linkActivityToContext(raw, [doneBest, activeSecond], NOW);
  assert.equal(link?.item.id, "ctx-active");
});

test("linkActivityToContext는 Snooze된 최선 매치 대신 활성 차선 Task를 선택한다", () => {
  const raw = adaptScreenFixtureToRawItem(screenFixture);
  const snoozedBest = osTask({
    id: "ctx-snoozed",
    metadata: { snoozedUntil: "2026-07-19T00:00:00+09:00" },
  });
  const activeSecond = osTask({ id: "ctx-active", title: "운영체제 시험 대비 계획" });

  const link = linkActivityToContext(raw, [snoozedBest, activeSecond], NOW);
  assert.equal(link?.item.id, "ctx-active");
});

test("linkActivityToContext는 범주형 공통 태그만 겹치면 연결하지 않는다", () => {
  const raw = adaptScreenFixtureToRawItem({
    ...screenFixture,
    activity: "task 목록을 확인 중",
    relatedTaskCandidate: "task",
  });
  const unrelated = osTask({ title: "영어 에세이 제출", tags: ["task"] });

  assert.equal(linkActivityToContext(raw, [unrelated], NOW), undefined);
});

test("linkActivityToContext는 Task가 아닌 ContextItem을 후보에서 제외한다", () => {
  const raw = adaptScreenFixtureToRawItem(screenFixture);
  const opportunity = osTask({ kind: "opportunity", title: "운영체제 시험 대비" });
  const task = osTask({ id: "ctx-task", title: "운영체제 시험 대비 계획" });

  assert.equal(linkActivityToContext(raw, [opportunity, task], NOW)?.item.id, "ctx-task");
});

function undergraduateProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    school: "전산학부", major: "전산학", year: "3학년 학부",
    interests: ["운영체제", "AI"], activityTypes: ["해커톤"],
    preferredLocations: [], explicitConstraints: [], ...overrides,
  };
}

test("relevanceScore는 관심사와 겹치는 태그에 가점한다", () => {
  const opp = osTask({ kind: "opportunity", tags: ["opportunity", "AI"] });
  const breakdown = relevanceScore(opp, undergraduateProfile());
  assert.ok(breakdown.interestOverlap > 0);
  assert.ok(breakdown.score > 0);
});

test("relevanceScore는 학부생에게 대학원생 전용 자격을 위반으로 감점한다", () => {
  const gradOnly = osTask({
    kind: "opportunity", title: "대학원생 대상 세미나",
    requirements: ["대학원생만 지원 가능"], tags: ["opportunity"],
  });
  const breakdown = relevanceScore(gradOnly, undergraduateProfile());
  assert.equal(breakdown.eligibilityViolated, true);
  assert.equal(breakdown.score, 0);
});

test("relevanceScore는 일반적인 N학년 입력도 학부생으로 판정한다", () => {
  const gradOnly = osTask({
    kind: "opportunity",
    title: "대학원생 대상 세미나",
    requirements: ["대학원생만 지원 가능"],
  });

  assert.equal(
    relevanceScore(gradOnly, undergraduateProfile({ year: "3학년" })).eligibilityViolated,
    true,
  );
  assert.equal(
    relevanceScore(gradOnly, undergraduateProfile({ year: "대학원 3학년" })).eligibilityViolated,
    false,
  );
});

test("relevanceScore는 자격이 애매하면 배제하지 않는다", () => {
  const ambiguous = osTask({ kind: "opportunity", title: "창업 경진대회", tags: ["opportunity", "AI"] });
  const breakdown = relevanceScore(ambiguous, undergraduateProfile());
  assert.equal(breakdown.eligibilityViolated, false);
});

test("generateScreenAdvice는 정책을 통과하면 LLM 조언을 생성한다", async () => {
  const raw = adaptScreenFixtureToRawItem(screenFixture);
  const link = linkActivityToContext(raw, [osTask()], NOW)!;
  const advice = await generateScreenAdvice({
    activityRawItem: raw,
    link,
    now: new Date("2026-07-18T15:20:00+09:00"),
    provider: fixedProvider({ advice: "18시 전까지 스케줄링 알고리즘 비교표를 작성하세요." }),
    privacyGateway: passthroughPrivacyGateway,
  });

  assert.match(advice?.advice ?? "", /비교표/);
  assert.equal(advice?.contextItemId, "ctx-os");
  assert.deepEqual(advice?.evidenceIds, ["ev-os"], "연결된 Task의 근거를 인용해야 한다");
});

test("generateScreenAdvice는 집중 모드면 조언하지 않는다", async () => {
  const raw = adaptScreenFixtureToRawItem(screenFixture);
  const link = linkActivityToContext(raw, [osTask()], NOW)!;
  const advice = await generateScreenAdvice({
    activityRawItem: raw, link, now: new Date("2026-07-18T15:20:00+09:00"),
    provider: fixedProvider({ advice: "x" }), privacyGateway: passthroughPrivacyGateway,
    focusMode: true,
  });
  assert.equal(advice, undefined);
});

test("linkActivityToContext는 완료·Snooze 상태의 Task만 있으면 연결하지 않는다", () => {
  const raw = adaptScreenFixtureToRawItem(screenFixture);
  assert.equal(linkActivityToContext(raw, [osTask({ status: "done" })], NOW), undefined);
  assert.equal(linkActivityToContext(raw, [osTask({
    metadata: { snoozedUntil: "2026-07-19T00:00:00+09:00" },
  })], NOW), undefined);
});

test("generateScreenAdvice는 최근 30분 이내 조언했으면 반복하지 않는다", async () => {
  const raw = adaptScreenFixtureToRawItem(screenFixture);
  const link = linkActivityToContext(raw, [osTask()], NOW)!;
  const advice = await generateScreenAdvice({
    activityRawItem: raw, link,
    now: new Date("2026-07-18T15:20:00+09:00"),
    lastAdvisedAt: new Date("2026-07-18T15:00:00+09:00"),
    provider: fixedProvider({ advice: "x" }),
    privacyGateway: passthroughPrivacyGateway,
  });
  assert.equal(advice, undefined);
});

test("generateScreenAdvice는 LLM 실패 시 억지 조언 없이 undefined를 반환한다", async () => {
  const raw = adaptScreenFixtureToRawItem(screenFixture);
  const link = linkActivityToContext(raw, [osTask()], NOW)!;
  const advice = await generateScreenAdvice({
    activityRawItem: raw, link, now: new Date("2026-07-18T15:20:00+09:00"),
    provider: failingProvider,
    privacyGateway: passthroughPrivacyGateway,
  });
  assert.equal(advice, undefined);
});

test("generateScreenAdvice는 Privacy Gateway를 거친 화면과 Task 정보만 Provider에 전달한다", async () => {
  let prompt = "";
  const provider: LLMProvider = {
    async completeJSON<T>(request: LLMJSONRequest<T>): Promise<T> {
      prompt = request.userPrompt;
      const value = { advice: "안전한 조언" };
      if (!request.validate(value)) throw new Error("invalid");
      return value;
    },
  };
  const raw = adaptScreenFixtureToRawItem({
    ...screenFixture,
    activity: "운영체제 자료에서 010-1234-5678 확인 중",
  });
  const item = osTask({ requirements: ["담당자 hong@example.com에게 학번 20231234 제출"] });
  const beforeRaw = structuredClone(raw);
  const beforeItem = structuredClone(item);
  const link = { item, similarity: 0.9, relevance: 14 };
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

  await generateScreenAdvice({
    activityRawItem: raw,
    link,
    now: NOW,
    provider,
    privacyGateway: maskingGateway,
  });

  assert.match(prompt, /\[전화번호\]/);
  assert.match(prompt, /\[이메일\]/);
  assert.match(prompt, /\[학번\]/);
  assert.doesNotMatch(prompt, /010-1234-5678|hong@example\.com|20231234/);
  assert.deepEqual(raw, beforeRaw);
  assert.deepEqual(item, beforeItem);
});

test("화면 confidence와 LLM 조언 응답의 비정상 값을 거부한다", async () => {
  for (const confidence of [Number.POSITIVE_INFINITY, 10, -1]) {
    const raw = adaptScreenFixtureToRawItem({ ...screenFixture, confidence });
    assert.equal(linkActivityToContext(raw, [osTask()], NOW), undefined);
  }

  const raw = adaptScreenFixtureToRawItem(screenFixture);
  const link = linkActivityToContext(raw, [osTask()], NOW)!;
  const advice = await generateScreenAdvice({
    activityRawItem: raw,
    link,
    now: NOW,
    provider: fixedProvider({ advice: "   " }),
    privacyGateway: passthroughPrivacyGateway,
  });
  assert.equal(advice, undefined);
});

const passthroughPrivacyGateway: PrivacyGateway = {
  async prepare(rawItem) {
    return structuredClone(rawItem);
  },
};

test("computePriority는 관련도 계산에 relevanceScore를 쓴다 — 관심사 겹침 가점", () => {
  const now = new Date("2026-07-18T00:00:00+09:00");
  const profile = undergraduateProfile({ interests: ["AI"], activityTypes: [] });
  const related = osTask({ kind: "opportunity", title: "AI 공모전", tags: ["opportunity", "AI"], deadline: undefined });
  const unrelated = osTask({ kind: "opportunity", title: "봉사활동", tags: ["opportunity"], deadline: undefined });

  const relatedScore = computePriority(related, [], { now, profile, recentRecommendations: [] });
  const unrelatedScore = computePriority(unrelated, [], { now, profile, recentRecommendations: [] });
  assert.ok(relatedScore.importance > unrelatedScore.importance, "관심사와 겹치는 Opportunity의 중요도가 더 높아야 한다");
});

test("computePriority는 활동유형 겹침도 관련도 가점으로 반영한다", () => {
  const now = new Date("2026-07-18T00:00:00+09:00");
  const profile = undergraduateProfile({ interests: [], activityTypes: ["해커톤"] });
  const related = osTask({ kind: "opportunity", title: "교내 해커톤", tags: ["opportunity", "해커톤"], deadline: undefined });
  const unrelated = osTask({ kind: "opportunity", title: "봉사활동", tags: ["opportunity"], deadline: undefined });

  const relatedScore = computePriority(related, [], { now, profile, recentRecommendations: [] });
  const unrelatedScore = computePriority(unrelated, [], { now, profile, recentRecommendations: [] });
  assert.ok(
    relatedScore.importance > unrelatedScore.importance,
    "활동유형(activityTypes)과 겹치는 Opportunity의 중요도가 더 높아야 한다",
  );
});

// 박도현님 리뷰: 예전 cap(10)은 겹침 2개에서 이미 닿아 2개와 5개가 같은 점수였다.
// relevanceScore를 실제로 반영하려던 목적과 반대로 작동하던 지점.
test("computePriority는 관련도 신호가 많을수록 중요도를 계속 구분한다", () => {
  const now = new Date("2026-07-18T00:00:00+09:00");
  const profile = undergraduateProfile({ interests: ["AI", "보안", "네트워크"], activityTypes: ["해커톤"] });
  const opportunity = (tags: string[]) =>
    osTask({ kind: "opportunity", tags: ["opportunity", ...tags], deadline: undefined });
  const priority = (tags: string[]) =>
    computePriority(opportunity(tags), [], { now, profile, recentRecommendations: [] }).importance;

  const one = priority(["AI"]);
  const two = priority(["AI", "보안"]);
  const three = priority(["AI", "보안", "네트워크"]);

  assert.ok(one < two, "겹침 1개보다 2개가 높아야 한다");
  assert.ok(two < three, "겹침 2개보다 3개가 높아야 한다");
});

// 김도연님 리뷰 P1: 중요도만 0으로 만들면 마감 긴급도(최대 40)와 미충족 요구사항
// (최대 15)이 그대로 더해진다. 하필 "대학원생만 지원 가능"이라는 자격 문구 자체가
// requirements 가점으로 계산돼, 부적격 Opportunity가 오히려 상단에 올 수 있었다.
test("computePriority는 자격 위반 Opportunity를 추천 후보에서 제외한다", () => {
  const now = new Date("2026-07-18T00:00:00+09:00");
  const profile = undergraduateProfile({ interests: ["AI"] });
  const gradOnly = osTask({
    kind: "opportunity", title: "대학원생 대상 세미나",
    requirements: ["대학원생만 지원 가능"], tags: ["opportunity", "AI"],
    deadline: "2026-07-18T06:00:00+09:00",
  });

  const breakdown = computePriority(gradOnly, [], { now, profile, recentRecommendations: [] });

  assert.equal(breakdown.excluded, true);
  assert.equal(breakdown.total, -Infinity);
  assert.match(breakdown.excludedReason ?? "", /지원 자격/);
});

// 같은 자격 문구가 Task 본문에 있다고 해서 이미 내게 주어진 과제를 감추면 안 된다.
// "지원 자격 미충족 시 추천하지 않는다"는 신청 대상(Opportunity)에 대한 정책이다.
test("computePriority는 Opportunity가 아닌 Context를 자격 문구로 제외하지 않는다", () => {
  const now = new Date("2026-07-18T00:00:00+09:00");
  const profile = undergraduateProfile();
  const task = osTask({
    kind: "task", title: "대학원생 대상 세미나 자료 정리",
    requirements: ["대학원생만 지원 가능"], tags: ["task"],
  });

  const breakdown = computePriority(task, [], { now, profile, recentRecommendations: [] });

  assert.equal(breakdown.excluded, false);
});
