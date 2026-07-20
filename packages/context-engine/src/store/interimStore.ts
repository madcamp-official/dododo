import type { ContextChangeEvent, Evidence, Recommendation } from "../../../shared/src/index.ts";

// Stage 0 임시 저장소: packages/shared/src/contracts.ts의 ContextRepository에
// Evidence·변경 이력·Recommendation 저장 메서드가 아직 없어 팀 합의 전까지
// context-engine 내부에서만 사용하는 자리 표시자다. 메서드 시그니처는
// docs/proposals/context-repository-contract-extension.md의 제안과 동일하게
// 맞춰 두어, 합의 후에는 실제 ContextRepository 구현으로 교체(리네임 수준)한다.
export class InterimContextStore {
  private readonly evidence = new Map<string, Evidence>();
  private readonly history = new Map<string, ContextChangeEvent[]>();
  private readonly recommendations = new Map<string, Recommendation[]>();

  async saveEvidence(items: Evidence[]): Promise<void> {
    for (const item of items) this.evidence.set(item.id, structuredClone(item));
  }

  async listEvidence(ids: string[]): Promise<Evidence[]> {
    return ids
      .map((id) => this.evidence.get(id))
      .filter((item): item is Evidence => item !== undefined)
      .map((item) => structuredClone(item));
  }

  async saveContextHistory(events: ContextChangeEvent[]): Promise<void> {
    for (const event of events) {
      const existing = this.history.get(event.contextItemId) ?? [];
      existing.push(structuredClone(event));
      this.history.set(event.contextItemId, existing);
    }
  }

  async listContextHistory(contextItemId: string): Promise<ContextChangeEvent[]> {
    return (this.history.get(contextItemId) ?? []).map((event) => structuredClone(event));
  }

  async saveRecommendations(recommendations: Recommendation[]): Promise<void> {
    for (const recommendation of recommendations) {
      const existing = this.recommendations.get(recommendation.contextItemId) ?? [];
      existing.push(structuredClone(recommendation));
      this.recommendations.set(recommendation.contextItemId, existing);
    }
  }

  async listRecommendations(contextItemId?: string): Promise<Recommendation[]> {
    if (contextItemId !== undefined) {
      return (this.recommendations.get(contextItemId) ?? []).map((item) => structuredClone(item));
    }

    return [...this.recommendations.values()].flat().map((item) => structuredClone(item));
  }
}
