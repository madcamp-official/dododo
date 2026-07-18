import type {
  ContextItem,
  Recommendation,
  RecommendationEngine,
  UserProfile,
} from "../../../shared/src/index.ts";

export class RuleBasedRecommendationEngine implements RecommendationEngine {
  async recommend(
    items: ContextItem[],
    _profile: UserProfile,
    now: Date,
  ): Promise<Recommendation[]> {
    return items
      .filter((item) => !["done", "cancelled", "dismissed"].includes(item.status))
      .map((item) => ({
        id: `rec-${item.id}-${now.getTime()}`,
        contextItemId: item.id,
        action: `${item.title}을(를) 확인하세요.`,
        reason: item.deadline ? `마감: ${item.deadline}` : "미처리 Context",
        score: item.priority,
        evidenceIds: item.evidenceIds,
        createdAt: now.toISOString(),
      }))
      .sort((a, b) => b.score - a.score);
  }
}
