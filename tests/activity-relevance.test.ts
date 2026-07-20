import assert from "node:assert/strict";
import test from "node:test";

import {
  adaptScreenFixtureToRawItem,
  generateScreenAdvice,
  linkActivityToContext,
  relevanceScore,
} from "../packages/context-engine/src/index.ts";
import type { LLMJSONRequest, LLMProvider } from "../packages/context-engine/src/index.ts";
import type { ContextItem, UserProfile } from "../packages/shared/src/index.ts";

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
    provider: fixedProvider({ advice: "x" }), focusMode: true,
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
  });
  assert.equal(advice, undefined);
});

test("generateScreenAdvice는 LLM 실패 시 억지 조언 없이 undefined를 반환한다", async () => {
  const raw = adaptScreenFixtureToRawItem(screenFixture);
  const link = linkActivityToContext(raw, [osTask()], NOW)!;
  const advice = await generateScreenAdvice({
    activityRawItem: raw, link, now: new Date("2026-07-18T15:20:00+09:00"),
    provider: failingProvider,
  });
  assert.equal(advice, undefined);
});
