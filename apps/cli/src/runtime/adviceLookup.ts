import type { ContextItem, RawItem } from "../../../../packages/shared/src/index.ts";

export interface ScreenAdviceInput {
  activity: RawItem;
  contextItems: ContextItem[];
  now: Date;
}

export interface ScreenAdviceDecision {
  advise: boolean;
  message?: string;
  evidenceIds?: string[];
  declineReason?: string;
}

export interface ScreenAdvicePolicy {
  evaluate(input: ScreenAdviceInput): Promise<ScreenAdviceDecision>;
}

const MIN_CONFIDENCE = 0.5;

// Runtime만으로 가능한 최소 placeholder다. Context Intelligence의 실제 정책
// (user-scenarios.md Scenario 5의 focus mode/최근 동일 조언/특이성 기준)은
// CliContainer.screenAdvicePolicy를 교체해 넣는다 — 이 인터페이스 모양은
// 그대로 유지되므로 Runtime 쪽 추가 변경 없이 슬롯인만 하면 된다.
export const defaultScreenAdvicePolicy: ScreenAdvicePolicy = {
  async evaluate(input: ScreenAdviceInput): Promise<ScreenAdviceDecision> {
    const candidate = input.activity.metadata.relatedTaskCandidate;
    const confidence = input.activity.metadata.confidence;

    if (typeof candidate !== "string" || candidate.trim() === "") {
      return { advise: false, declineReason: "화면 활동에서 관련 작업 후보를 찾지 못했습니다" };
    }
    if (typeof confidence !== "number" || confidence < MIN_CONFIDENCE) {
      return { advise: false, declineReason: "화면 활동 인식 확신도가 낮습니다" };
    }

    const matched = input.contextItems.find(
      (item) => item.kind === "task" && titlesOverlap(item.title, candidate),
    );
    if (matched === undefined) {
      return { advise: false, declineReason: `'${candidate}'와 관련된 Task를 찾지 못했습니다` };
    }

    return {
      advise: true,
      message: `'${matched.title}' 작업과 관련된 활동으로 보입니다. 관련 내용을 계속 진행하세요.`,
      evidenceIds: matched.evidenceIds,
    };
  },
};

function titlesOverlap(a: string, b: string): boolean {
  const normalize = (value: string): string => value.toLowerCase().replaceAll(/\s+/g, "");
  const normalizedA = normalize(a);
  const normalizedB = normalize(b);
  return normalizedA.includes(normalizedB) || normalizedB.includes(normalizedA);
}
