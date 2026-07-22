import type {
  ContextItem,
  Recommendation,
  RecommendationEngine,
  UserProfile,
} from "../../../shared/src/index.ts";
import type { LLMProvider } from "../llm/provider.ts";
import { deterministicPhrasing, generateActionAndReason } from "./phrasing.ts";
import { computePriority, findTodayEvents } from "./priority.ts";

export * from "./phrasing.ts";
export * from "./priority.ts";

// 최근 추천 이력을 조회하는 최소 인터페이스. ContextRepository가 이 모양을 그대로
// 만족한다(구조적 타이핑이라 별도 어댑터가 필요 없다). packages/shared/src/contracts.ts의
// RecommendationEngine 계약 자체는 넓히지 않고 생성자 주입으로 해결하기로 확정했다 —
// recommend(items, profile, now)의 좁은 시그니처를 그대로 유지해 계약 변경 없이
// 이력 조회를 옵션으로 추가할 수 있기 때문이다.
export interface RecommendationHistoryProvider {
  listRecommendations(contextItemId?: string): Promise<Recommendation[]>;
}

export interface RuleBasedRecommendationEngineOptions {
  llmProvider?: LLMProvider;
  history?: RecommendationHistoryProvider;
  // llm-architecture.md §4-2: today/inbox/watch가 항목마다 LLM 문장 생성을 순차
  // 호출해 항목 수만큼 지연이 늘어난다. 우선순위가 가장 높은 상위 N개만 LLM으로
  // 문구를 생성하고 나머지는 결정론적 템플릿을 쓴다.
  llmPhrasingLimit?: number;
}

const DEFAULT_LLM_PHRASING_LIMIT = 5;

export class RuleBasedRecommendationEngine implements RecommendationEngine {
  private readonly llmProvider: LLMProvider | undefined;
  private readonly history: RecommendationHistoryProvider | undefined;
  private readonly llmPhrasingLimit: number;

  constructor(options: RuleBasedRecommendationEngineOptions = {}) {
    this.llmProvider = options.llmProvider;
    this.history = options.history;
    this.llmPhrasingLimit = Math.max(0, options.llmPhrasingLimit ?? DEFAULT_LLM_PHRASING_LIMIT);
  }

  async recommend(items: ContextItem[], profile: UserProfile, now: Date): Promise<Recommendation[]> {
    const todayEvents = findTodayEvents(items, now);
    const scored: { item: ContextItem; breakdown: ReturnType<typeof computePriority> }[] = [];

    for (const item of items) {
      const recentRecommendations = this.history === undefined
        ? []
        : await this.history.listRecommendations(item.id);

      const breakdown = computePriority(item, todayEvents, {
        now,
        profile,
        recentRecommendations,
      });
      if (!breakdown.excluded) scored.push({ item, breakdown });
    }

    scored.sort((a, b) => b.breakdown.total - a.breakdown.total);

    // 우선순위 상위 llmPhrasingLimit개만 LLM 문구를 병렬로 생성한다 — 나머지는
    // 순위가 낮아 사용자가 먼저 볼 가능성이 낮으므로 지연 없는 템플릿으로 채운다.
    // generateActionAndReason은 실패 시 이미 내부에서 deterministicPhrasing으로
    // 폴백하므로(phrasing.ts) Promise.all 중 하나가 거부되어 나머지를 막는 일은 없다.
    const phrasings = await Promise.all(scored.map(({ item, breakdown }, index) => {
      if (this.llmProvider === undefined || index >= this.llmPhrasingLimit) {
        return deterministicPhrasing(item);
      }
      return generateActionAndReason(item, breakdown, this.llmProvider);
    }));

    return scored.map(({ item, breakdown }, index) => {
      const phrasing = phrasings[index];
      return {
        id: `rec-${item.id}-${now.getTime()}`,
        contextItemId: item.id,
        action: phrasing.action,
        reason: phrasing.reason,
        score: breakdown.total,
        evidenceIds: item.evidenceIds,
        createdAt: now.toISOString(),
      };
    });
  }
}
