import type { ContextItem, ContextKind, Evidence, Fact, RawItem } from "../../../shared/src/index.ts";
import { trigramSimilarity } from "./similarity.ts";

export interface MergeCandidate {
  fact: Fact;
  rawItem: RawItem;
  kind: ContextKind;
}

export interface MergeScoreBreakdown {
  total: number;
  titleSimilarity: number;
  sameSubject: number;
  deadlineProximity: number;
  attachmentRelation: number;
  peopleOverlap: number;
  blocked: boolean;
  blockedReason?: string;
}

// README 병합 점수 기준표를 코드로 구현한다: 제목·의미 유사도 0-40, 같은 과목·프로젝트
// 0-20, 마감일 근접성 0-15, 첨부파일 관계 0-15, 등장인물·팀원 0-10. 점수 자체는 항상
// 코드가 계산하고 LLM은 쓰지 않는다 — 40~69점 애매 구간의 사용자 확인 문장 생성에만
// LLM을 쓰는 건 recommendation/phrasing 단계(Stage 4 이후)의 몫이다.
export function computeMergeScore(
  candidate: MergeCandidate,
  existing: ContextItem,
  existingEvidence: Evidence[],
): MergeScoreBreakdown {
  const blockedReason = checkHardGuards(candidate, existing);
  if (blockedReason !== undefined) {
    return {
      total: 0,
      titleSimilarity: 0,
      sameSubject: 0,
      deadlineProximity: 0,
      attachmentRelation: 0,
      peopleOverlap: 0,
      blocked: true,
      blockedReason,
    };
  }

  const titleSimilarity = trigramSimilarity(candidate.fact.subject, existing.title) * 40;
  const sameSubject = sameSubjectProjectScore(candidate.rawItem, existing);
  const deadlineProximity = deadlineProximityScore(candidate.fact.eventTime, existing.deadline);
  const attachmentRelation = attachmentRelationScore(candidate.rawItem, existingEvidence);
  const peopleOverlap = peopleOverlapScore(candidate.fact, existing);

  return {
    total: titleSimilarity + sameSubject + deadlineProximity + attachmentRelation + peopleOverlap,
    titleSimilarity,
    sameSubject,
    deadlineProximity,
    attachmentRelation,
    peopleOverlap,
    blocked: false,
  };
}

// 절대 병합 금지 조건. kind가 다르면 점수와 무관하게 병합하지 않는다(Opportunity와
// Task가 우연히 제목이 비슷해도 절대 하나로 합치지 않는다). LMS 출처처럼 "과제 2"·
// "과제 3"이 텍스트만 비슷하고 번호가 다르면 강제로 0점 처리한다
// (user-scenarios.md 시나리오 3: "과제 2와 과제 3은 병합하지 않는다").
function checkHardGuards(candidate: MergeCandidate, existing: ContextItem): string | undefined {
  if (candidate.kind !== existing.kind) {
    return `kind가 다름 (${candidate.kind} vs ${existing.kind})`;
  }

  const candidateNumber = extractAssignmentNumber(candidate.fact.subject);
  const existingNumber = extractAssignmentNumber(existing.title);
  if (
    candidateNumber !== undefined
    && existingNumber !== undefined
    && candidateNumber !== existingNumber
  ) {
    return `과제 번호 불일치 (${candidateNumber} vs ${existingNumber})`;
  }

  return undefined;
}

function extractAssignmentNumber(text: string): string | undefined {
  return /(?:과제|assignment)\s*#?(\d+)/i.exec(text)?.[1];
}

// course/category 신호가 양쪽 다 있고 같으면 확신(20), 양쪽 다 있고 다르면 확실히
// 다른 주제(0). 한쪽만 있으면 모순되는 정보는 없다는 뜻이라 부분 점수(15)를 주고,
// 둘 다 없으면 신호가 아예 없다는 뜻이라 최소 점수(5)만 준다 — 메타데이터가 빈약한
// 출처(예: 이메일)라는 이유만으로 병합이 항상 막히지 않게 하기 위함이다.
function sameSubjectProjectScore(rawItem: RawItem, existing: ContextItem): number {
  const candidateSubject = pickSubjectSignal(rawItem.metadata);
  const existingSubject = pickSubjectSignal(existing.metadata);

  if (candidateSubject !== undefined && existingSubject !== undefined) {
    return candidateSubject === existingSubject ? 20 : 0;
  }
  if (candidateSubject !== undefined || existingSubject !== undefined) return 15;
  return 5;
}

// recommendation/priority.ts의 "오늘 관련 일정" 계산도 같은 course/category 신호로
// 항목을 서로 연관짓기 때문에 export해서 재사용한다.
export function pickSubjectSignal(metadata: Record<string, unknown>): string | undefined {
  if (typeof metadata.course === "string") return metadata.course;
  if (typeof metadata.category === "string") return metadata.category;
  return undefined;
}

function deadlineProximityScore(candidateTime: string | undefined, existingDeadline: string | undefined): number {
  if (candidateTime === undefined || existingDeadline === undefined) return 0;

  const candidateMs = Date.parse(candidateTime);
  const existingMs = Date.parse(existingDeadline);
  if (Number.isNaN(candidateMs) || Number.isNaN(existingMs)) return 0;

  const daysApart = Math.abs(candidateMs - existingMs) / (1000 * 60 * 60 * 24);
  if (daysApart >= 7) return 0;
  return 15 * (1 - daysApart / 7);
}

// 현재 Fixture는 첨부파일 메타데이터를 채우지 않아 항상 0을 반환하는 게 정상이다.
// Collector가 metadata.attachments: string[](contentHash 목록)를 채우기 시작하면
// existingEvidence의 근거와 겹치는 첨부가 있는지 비교하도록 확장한다.
function attachmentRelationScore(rawItem: RawItem, _existingEvidence: Evidence[]): number {
  const attachments = rawItem.metadata.attachments;
  if (!Array.isArray(attachments) || attachments.length === 0) return 0;
  return 0;
}

const KOREAN_NAME_PATTERN = /[가-힣]{2,4}(?=\s*(?:님|교수|조교|팀원))/g;

function peopleOverlapScore(fact: Fact, existing: ContextItem): number {
  const existingPeople = existing.metadata.people;
  if (!Array.isArray(existingPeople) || existingPeople.length === 0) return 0;

  const candidatePeople = extractPeople(`${fact.value} ${fact.evidenceText}`);
  const overlap = [...candidatePeople].some((name) => existingPeople.includes(name));
  return overlap ? 10 : 0;
}

function extractPeople(text: string): Set<string> {
  return new Set([...text.matchAll(KOREAN_NAME_PATTERN)].map((match) => match[0]));
}
