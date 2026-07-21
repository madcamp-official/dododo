import type { ContextChangeEvent, Evidence, Recommendation } from "../../../shared/src/index.ts";

// Stage 0 임시 저장소였다. packages/shared/src/contracts.ts의 ContextRepository에
// Evidence·변경 이력·Recommendation 저장 메서드가 이미 반영되었고(saveEvidence 등),
// ContextPipeline도 InterimContextStore가 아니라 실제 ContextRepository를
// evidenceStore로 직접 쓴다(pipeline.ts 참고). 이 클래스는 더 이상 프로덕션 경로에서
// 쓰이지 않는다 — tests/smoke.test.ts의 자체 라운드트립 테스트만 남아 있어 삭제 대상이다.
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
