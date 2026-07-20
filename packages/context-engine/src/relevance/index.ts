import type { ContextItem, UserProfile } from "../../../shared/src/index.ts";

// 사용자 프로필 기반 Opportunity 관련도. Opportunity를 Inbox에 얼마나 강하게 올릴지,
// 그리고 우선순위(recommendation/priority.ts)의 중요도 신호로 쓰인다. 점수는 항상
// 코드로 계산하고 LLM은 쓰지 않는다(README/AGENTS.md).
export interface RelevanceBreakdown {
  score: number;
  interestOverlap: number;
  activityOverlap: number;
  eligibilityViolated: boolean;
}

const INTEREST_WEIGHT = 10;
const ACTIVITY_WEIGHT = 8;
const MAX_SCORE = 100;

export function relevanceScore(item: ContextItem, profile: UserProfile): RelevanceBreakdown {
  const signals = new Set(item.tags.map(normalize));

  const interestOverlap = countOverlap(profile.interests, signals) * INTEREST_WEIGHT;
  const activityOverlap = countOverlap(profile.activityTypes, signals) * ACTIVITY_WEIGHT;

  // 지원 자격을 명백히 충족하지 못하면 크게 감점한다. 단 애매한 경우에는 배제하지 않는다
  // — 관련 있는 기회를 놓치는 false negative가, 낮은 점수로라도 노출되는 것보다 나쁘다
  // (user-scenarios.md 시나리오 1: "지원 자격을 충족하지 않으면 기본적으로 추천하지 않는다"를
  // 명백한 위반에만 적용).
  const eligibilityViolated = violatesEligibility(item, profile);

  const raw = interestOverlap + activityOverlap - (eligibilityViolated ? 100 : 0);
  return {
    score: clamp(raw, 0, MAX_SCORE),
    interestOverlap,
    activityOverlap,
    eligibilityViolated,
  };
}

function countOverlap(profileValues: string[], signals: Set<string>): number {
  const normalizedProfile = new Set(profileValues.map(normalize));
  let count = 0;
  for (const value of normalizedProfile) {
    if (value !== "" && signals.has(value)) count += 1;
  }
  return count;
}

// requirements/본문 텍스트에 "대학원생만", "졸업생 대상"처럼 사용자의 학년/신분과
// 명백히 배치되는 자격 제한이 있으면 위반으로 본다. 프로필에 학년 정보가 없으면
// 판단 근거가 없으므로 위반으로 처리하지 않는다(애매 → 노출).
function violatesEligibility(item: ContextItem, profile: UserProfile): boolean {
  const haystack = [...item.requirements, item.title].join(" ");
  const academicText = `${profile.year} ${profile.school}`;
  const explicitlyGraduate = /대학원|석사|박사/.test(academicText);
  const ordinaryYear = /(?:^|\s)[1-6]\s*학년(?:\s|$)/.test(profile.year);
  const isUndergraduate = !explicitlyGraduate
    && (/학부|학사|대학생/.test(academicText) || ordinaryYear);

  if (isUndergraduate && /대학원생\s*(만|한정|대상)|석사\s*(만|이상)|졸업생\s*(만|한정|대상)/.test(haystack)) {
    return true;
  }
  return false;
}

function normalize(value: string): string {
  return value.toLocaleLowerCase("ko-KR").replaceAll(/\s+/g, "").trim();
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
