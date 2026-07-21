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
}

export class RuleBasedRecommendationEngine implements RecommendationEngine {
  private readonly llmProvider: LLMProvider | undefined;
  private readonly history: RecommendationHistoryProvider | undefined;

  constructor(options: RuleBasedRecommendationEngineOptions = {}) {
    this.llmProvider = options.llmProvider;
    this.history = options.history;
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

    const recommendations: Recommendation[] = [];
    for (const { item, breakdown } of scored) {
      const phrasing = this.llmProvider === undefined
        ? deterministicPhrasing(item)
        : await generateActionAndReason(item, breakdown, this.llmProvider);

      recommendations.push({
        id: `rec-${item.id}-${now.getTime()}`,
        contextItemId: item.id,
        action: phrasing.action,
        reason: phrasing.reason,
        score: breakdown.total,
        evidenceIds: item.evidenceIds,
        createdAt: now.toISOString(),
      });
    }

    return recommendations;
  }
}
