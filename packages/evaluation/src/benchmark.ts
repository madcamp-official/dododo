import type { ContextItem } from "../../shared/src/index.ts";
import { calculateBinaryMetrics, type BinaryMetrics } from "./index.ts";
import type { ExpectedContextItem } from "./groundTruth.ts";

// 추출·분류 채점. evaluation 패키지는 context-engine에 의존하지 않고, 파이프라인이
// 만든 결과(ContextItem[])와 Ground Truth를 비교하는 순수 함수만 제공한다. 실제
// 파이프라인 실행은 호출부(테스트/CLI)가 담당한다.
export interface ExtractionFailure {
  type: "missing" | "unexpected" | "wrong_kind";
  expectedTitle?: string;
  actualTitle?: string;
  expectedKind?: ExpectedContextItem["kind"];
  actualKind?: ContextItem["kind"];
}

export interface ExtractionEvaluation {
  metrics: BinaryMetrics;
  truePositive: number;
  falsePositive: number;
  falseNegative: number;
  failures: ExtractionFailure[];
}

// 기대 항목과 실제 항목을 제목·kind로 대응시켜 tp/fp/fn을 센다.
// - tp: 제목이 매칭되고 kind도 같은 실제 항목
// - fn: 매칭되는 실제 항목이 없는 기대 항목(누락) 또는 kind가 다른 경우(오분류)
// - fp: 어떤 기대 항목과도 매칭되지 않는 실제 항목(과잉 생성) 또는 kind가 다른 경우
// 오분류는 기대한 정답을 놓친 동시에 잘못된 종류의 결과를 생성했으므로 fn과 fp에 모두
// 반영한다. 그래야 precision과 recall이 함께 실제 품질 저하를 나타낸다.
export function evaluateExtraction(
  expected: ExpectedContextItem[],
  actual: ContextItem[],
): ExtractionEvaluation {
  const failures: ExtractionFailure[] = [];
  const usedActual = new Set<number>();
  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;

  for (const want of expected) {
    const index = actual.findIndex((item, i) => !usedActual.has(i) && titlesMatch(item.title, want.title));
    if (index === -1) {
      falseNegative += 1;
      failures.push({ type: "missing", expectedTitle: want.title, expectedKind: want.kind });
      continue;
    }

    usedActual.add(index);
    if (actual[index]!.kind !== want.kind) {
      falsePositive += 1;
      falseNegative += 1;
      failures.push({
        type: "wrong_kind",
        expectedTitle: want.title,
        expectedKind: want.kind,
        actualKind: actual[index]!.kind,
      });
      continue;
    }

    truePositive += 1;
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
