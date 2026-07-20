import type { ContextItem } from "../../shared/src/index.ts";
import { calculateBinaryMetrics, type BinaryMetrics } from "./index.ts";
import type { ExpectedContextItem } from "./groundTruth.ts";

// 추출·분류 채점. evaluation 패키지는 context-engine에 의존하지 않고, 파이프라인이
// 만든 결과(ContextItem[])와 Ground Truth를 비교하는 순수 함수만 제공한다. 실제
// 파이프라인 실행은 호출부(테스트/CLI)가 담당한다.
export interface ExtractionFailure {
  type: "missing" | "unexpected" | "wrong_kind" | "wrong_deadline" | "wrong_evidence_count";
  expectedTitle?: string;
  actualTitle?: string;
  expectedKind?: ExpectedContextItem["kind"];
  actualKind?: ContextItem["kind"];
  expectedDeadline?: string;
  actualDeadline?: string;
  expectedEvidenceCount?: number;
  actualEvidenceCount?: number;
}

export interface ExtractionEvaluation {
  metrics: BinaryMetrics;
  truePositive: number;
  falsePositive: number;
  falseNegative: number;
  failures: ExtractionFailure[];
}

// 기대 항목과 실제 항목을 제목으로 대응시키고 kind·deadline·evidenceCount까지 비교해
// tp/fp/fn을 센다. 제목 후보는 kind 일치, 정확한 제목, 핵심 필드 일치, 더 구체적인 제목
// 순으로 전역 정렬한 뒤 1:1로 소비한다. 따라서 짧은 포함 제목이나 배열 순서가 더 정확한
// 매치를 가로채지 않는다.
// - tp: 제목이 매칭되고 kind·deadline·evidenceCount가 모두 같은 실제 항목
// - fn: 매칭되는 실제 항목이 없거나 핵심 필드가 다른 기대 항목
// - fp: 어떤 기대 항목과도 매칭되지 않거나 핵심 필드가 다른 실제 항목
// 필드가 다른 항목은 기대한 정답을 놓친 동시에 잘못된 결과를 생성했으므로 fn과 fp에
// 각각 한 번만 반영한다. 여러 필드가 틀리면 실패 원인은 각각 남기되 항목 수는 중복 집계하지 않는다.
export function evaluateExtraction(
  expected: ExpectedContextItem[],
  actual: ContextItem[],
): ExtractionEvaluation {
  const failures: ExtractionFailure[] = [];
  const usedActual = new Set<number>();
  const actualIndexByExpected = matchContextItems(expected, actual);
  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;

  for (const [expectedIndex, want] of expected.entries()) {
    const index = actualIndexByExpected.get(expectedIndex);
    if (index === undefined) {
      falseNegative += 1;
      failures.push({ type: "missing", expectedTitle: want.title, expectedKind: want.kind });
      continue;
    }

    usedActual.add(index);
    const got = actual[index]!;
    if (got.kind !== want.kind) {
      falsePositive += 1;
      falseNegative += 1;
      failures.push({
        type: "wrong_kind",
        expectedTitle: want.title,
        actualTitle: got.title,
        expectedKind: want.kind,
        actualKind: got.kind,
      });
      continue;
    }

    const deadlineCorrect = deadlinesMatch(got.deadline, want.deadline);
    const actualEvidenceCount = new Set(got.evidenceIds).size;
    const evidenceCountCorrect = actualEvidenceCount === want.evidenceCount;

    if (deadlineCorrect && evidenceCountCorrect) {
      truePositive += 1;
      continue;
    }

    falsePositive += 1;
    falseNegative += 1;
    if (!deadlineCorrect) {
      failures.push({
        type: "wrong_deadline",
        expectedTitle: want.title,
        actualTitle: got.title,
        expectedDeadline: want.deadline,
        actualDeadline: got.deadline,
      });
    }
    if (!evidenceCountCorrect) {
      failures.push({
        type: "wrong_evidence_count",
        expectedTitle: want.title,
        actualTitle: got.title,
        expectedEvidenceCount: want.evidenceCount,
        actualEvidenceCount,
      });
    }
  }

  actual.forEach((item, i) => {
    if (usedActual.has(i)) return;
    falsePositive += 1;
    failures.push({ type: "unexpected", actualTitle: item.title, actualKind: item.kind });
  });

  return {
    metrics: calculateBinaryMetrics(truePositive, falsePositive, falseNegative),
    truePositive,
    falsePositive,
    falseNegative,
    failures,
  };
}

interface MatchCandidate {
  expectedIndex: number;
  actualIndex: number;
  kindExact: boolean;
  titleExact: boolean;
  matchingCoreFields: number;
  specificity: number;
  expectedKey: string;
  actualKey: string;
}

function matchContextItems(
  expected: ExpectedContextItem[],
  actual: ContextItem[],
): Map<number, number> {
  const candidates: MatchCandidate[] = [];

  for (const [expectedIndex, want] of expected.entries()) {
    for (const [actualIndex, got] of actual.entries()) {
      if (!titlesMatch(got.title, want.title)) continue;
      const expectedKey = normalizeTitle(want.title);
      const actualKey = normalizeTitle(got.title);
      candidates.push({
        expectedIndex,
        actualIndex,
        kindExact: got.kind === want.kind,
        titleExact: actualKey === expectedKey,
        matchingCoreFields: Number(deadlinesMatch(got.deadline, want.deadline))
          + Number(new Set(got.evidenceIds).size === want.evidenceCount),
        specificity: Math.min(expectedKey.length, actualKey.length),
        expectedKey,
        actualKey,
      });
    }
  }

  candidates.sort(compareCandidates);
  const matchedExpected = new Map<number, number>();
  const matchedActual = new Set<number>();
  for (const candidate of candidates) {
    if (matchedExpected.has(candidate.expectedIndex) || matchedActual.has(candidate.actualIndex)) continue;
    matchedExpected.set(candidate.expectedIndex, candidate.actualIndex);
    matchedActual.add(candidate.actualIndex);
  }
  return matchedExpected;
}

function compareCandidates(a: MatchCandidate, b: MatchCandidate): number {
  return Number(b.kindExact) - Number(a.kindExact)
    || Number(b.titleExact) - Number(a.titleExact)
    || b.matchingCoreFields - a.matchingCoreFields
    || b.specificity - a.specificity
    || a.expectedKey.localeCompare(b.expectedKey, "ko-KR")
    || a.actualKey.localeCompare(b.actualKey, "ko-KR")
    || a.expectedIndex - b.expectedIndex
    || a.actualIndex - b.actualIndex;
}

function deadlinesMatch(actual: string | undefined, expected: string | undefined): boolean {
  if (actual === expected) return true;
  if (actual === undefined || expected === undefined) return false;
  const actualTime = Date.parse(actual);
  const expectedTime = Date.parse(expected);
  return Number.isFinite(actualTime) && Number.isFinite(expectedTime) && actualTime === expectedTime;
}

// 제목 비교는 공백·대소문자를 정규화한 뒤 완전 일치 또는 한쪽이 다른 쪽을 포함하는지로
// 판단한다("대학생 AI 해커톤"과 "대학생 AI 해커톤 참가자 모집"을 같은 항목으로 본다).
function titlesMatch(a: string, b: string): boolean {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (na === "" || nb === "") return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

function normalizeTitle(value: string): string {
  return value.toLocaleLowerCase("ko-KR").replaceAll(/\s+/g, "").trim();
}
