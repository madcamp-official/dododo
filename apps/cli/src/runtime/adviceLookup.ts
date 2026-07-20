import {
  generateScreenAdvice,
  linkActivityToContext,
  type LLMProvider,
} from "../../../../packages/context-engine/src/index.ts";
import type {
  ContextItem,
  PrivacyGateway,
  RawItem,
} from "../../../../packages/shared/src/index.ts";

export interface ScreenAdviceInput {
  activity: RawItem;
  contextItems: ContextItem[];
  now: Date;
  // 사용자가 dododo advise --screen --focus로 명시할 때만 true. 영속 저장하지 않는다
  // (이슈#27 논의: 이 값을 매 실행마다 플래그로 받기로 결정 — CliContainer/도메인 변경 없음).
  focusMode?: boolean;
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

// PR#29 요청: linkActivityToContext(trigram 유사도+상태 필터)로 관련 Task를 찾고
// generateScreenAdvice(LLM)로 조언 문장을 만드는 실제 정책. provider가 있을 때만
// container.ts가 이걸로 defaultScreenAdvicePolicy를 대체한다.
//
// generateScreenAdvice의 lastAdvisedAt은 "이 Task에 마지막으로 조언한 시각"이라
// 어떤 Task와 연결됐는지 안 뒤엔(linkActivityToContext 실행 후) 알 수 없다 — 그래서
// 이 값은 ScreenAdviceInput으로 안 받고 정책 인스턴스가 Task id별로 직접 추적한다.
// 인메모리라 프로세스 재시작하면 초기화되는 건 알려진 한계(SQLite 전환 시 해결 — 이슈#27).
export class LlmScreenAdvicePolicy implements ScreenAdvicePolicy {
  private readonly provider: LLMProvider;
  private readonly privacyGateway: PrivacyGateway;
  private readonly lastAdvisedAt = new Map<string, Date>();

  constructor(provider: LLMProvider, privacyGateway: PrivacyGateway) {
    this.provider = provider;
    this.privacyGateway = privacyGateway;
  }

  async evaluate(input: ScreenAdviceInput): Promise<ScreenAdviceDecision> {
    const link = linkActivityToContext(input.activity, input.contextItems, input.now);
    if (link === undefined) {
      return { advise: false, declineReason: "화면 활동과 관련된 Task를 찾지 못했거나 확신도가 낮습니다" };
    }

    const advice = await generateScreenAdvice({
      activityRawItem: input.activity,
      link,
      now: input.now,
      provider: this.provider,
      privacyGateway: this.privacyGateway,
      lastAdvisedAt: this.lastAdvisedAt.get(link.item.id),
      focusMode: input.focusMode,
    });

    if (advice === undefined) {
      return {
        advise: false,
        declineReason: input.focusMode === true
          ? "집중 모드가 활성화돼 있어 조언하지 않습니다"
          : `'${link.item.title}'와 관련은 있지만 조언 조건을 만족하지 않습니다(상태·최근 조언 여부 등)`,
      };
    }

    this.lastAdvisedAt.set(link.item.id, input.now);
    return { advise: true, message: advice.advice, evidenceIds: advice.evidenceIds };
  }
}
