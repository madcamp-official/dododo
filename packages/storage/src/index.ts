import type {
  ContextChangeEvent,
  ContextItem,
  ContextRepository,
  Evidence,
  Fact,
  RawItem,
  RawItemAnalysisResult,
  Recommendation,
  StoredFact,
} from "../../shared/src/index.ts";
import { hasSameActiveFacts } from "./analysis-idempotency.ts";

export * from "./in-memory-raw-item-repository.ts";
export * from "./raw-item-repository.ts";
export * from "./raw-item-sync-service.ts";
export * from "./sqlite/index.ts";

export class InMemoryContextRepository implements ContextRepository {
  private rawItems = new Map<string, RawItem>();
  private facts = new Map<string, StoredFact>();
  private contextItems = new Map<string, ContextItem>();
  private evidence = new Map<string, Evidence>();
  private history = new Map<string, ContextChangeEvent>();
  private recommendations = new Map<string, Recommendation>();

  async saveRawItems(items: RawItem[]): Promise<void> {
    for (const item of items) this.rawItems.set(item.id, structuredClone(item));
  }

  async saveFacts(facts: Fact[]): Promise<void> {
    for (const fact of facts) {
      const existing = this.facts.get(fact.id);
      if (existing?.status === "inactive") {
        throw new Error(`비활성 Fact ID는 새 분석에서 재사용할 수 없습니다: ${fact.id}`);
      }
      this.facts.set(fact.id, { ...structuredClone(fact), status: "active" });
    }
  }

  async saveContextItems(items: ContextItem[]): Promise<void> {
    for (const item of items) this.contextItems.set(item.id, structuredClone(item));
  }

  async listContextItems(kind?: ContextItem["kind"]): Promise<ContextItem[]> {
    return [...this.contextItems.values()]
      .filter((item) => kind === undefined || item.kind === kind)
      .map((item) => structuredClone(item));
  }

  async findContextItem(id: string): Promise<ContextItem | undefined> {
    const item = this.contextItems.get(id);
    return item ? structuredClone(item) : undefined;
  }

  async listFactsByRawItemId(
    rawItemId: string,
    options: { includeInactive?: boolean } = {},
  ): Promise<StoredFact[]> {
    return [...this.facts.values()]
      .filter((fact) => fact.rawItemId === rawItemId)
      .filter((fact) => options.includeInactive === true || fact.status === "active")
      .map((fact) => structuredClone(fact));
  }

  async deactivateFactsByRawItemId(rawItemId: string, deactivatedAt: string): Promise<void> {
    for (const [id, fact] of this.facts) {
      if (fact.rawItemId !== rawItemId || fact.status === "inactive") continue;
      this.facts.set(id, { ...fact, status: "inactive", supersededAt: deactivatedAt });
    }
  }

  async saveEvidence(items: Evidence[]): Promise<void> {
    for (const item of items) this.evidence.set(item.id, structuredClone(item));
  }

  async listEvidence(ids: string[]): Promise<Evidence[]> {
    return ids
      .map((id) => this.evidence.get(id))
      .filter((item): item is Evidence => item !== undefined)
      .map((item) => structuredClone(item));
  }

  async listEvidenceByContextItemId(contextItemId: string): Promise<Evidence[]> {
    const item = this.contextItems.get(contextItemId);
    if (item === undefined) return [];
    return this.listEvidence(item.evidenceIds);
  }

  async saveContextHistory(events: ContextChangeEvent[]): Promise<void> {
    for (const event of events) {
      const existing = this.history.get(event.id);
      if (existing !== undefined && !isStructurallyEqual(existing, event)) {
        throw new Error(`Context 변경 이력은 수정할 수 없습니다: ${event.id}`);
      }
      if (existing === undefined) this.history.set(event.id, structuredClone(event));
    }
  }

  async listContextHistory(contextItemId: string): Promise<ContextChangeEvent[]> {
    return [...this.history.values()]
      .filter((event) => event.contextItemId === contextItemId)
      .map((event) => structuredClone(event));
  }

  async saveRecommendations(items: Recommendation[]): Promise<void> {
    for (const item of items) this.recommendations.set(item.id, structuredClone(item));
  }

  async listRecommendations(contextItemId?: string): Promise<Recommendation[]> {
    return [...this.recommendations.values()]
      .filter((item) => contextItemId === undefined || item.contextItemId === contextItemId)
      .map((item) => structuredClone(item));
  }

  async saveRawItemAnalysis(result: RawItemAnalysisResult): Promise<void> {
    const snapshot = this.snapshot();
    try {
      await this.saveRawItems([result.rawItem]);
      const activeFacts = await this.listFactsByRawItemId(result.rawItem.id);
      if (!hasSameActiveFacts(activeFacts, result.facts)) {
        await this.deactivateFactsByRawItemId(result.rawItem.id, result.analyzedAt);
        await this.saveFacts(result.facts);
      }
      await this.saveContextItems(result.contextItems);
      await this.saveEvidence(result.evidence);
      await this.saveContextHistory(result.history);
      await this.saveRecommendations(result.recommendations ?? []);
    } catch (error) {
      this.restore(snapshot);
      throw error;
    }
  }

  private snapshot(): RepositorySnapshot {
    return structuredClone({
      rawItems: this.rawItems,
      facts: this.facts,
      contextItems: this.contextItems,
      evidence: this.evidence,
      history: this.history,
      recommendations: this.recommendations,
    });
  }

  private restore(snapshot: RepositorySnapshot): void {
    this.rawItems = snapshot.rawItems;
    this.facts = snapshot.facts;
    this.contextItems = snapshot.contextItems;
    this.evidence = snapshot.evidence;
    this.history = snapshot.history;
    this.recommendations = snapshot.recommendations;
  }
}

interface RepositorySnapshot {
  rawItems: Map<string, RawItem>;
  facts: Map<string, StoredFact>;
  contextItems: Map<string, ContextItem>;
  evidence: Map<string, Evidence>;
  history: Map<string, ContextChangeEvent>;
  recommendations: Map<string, Recommendation>;
}

function isStructurallyEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

// TODO(Data & Storage): 같은 ContextRepository 계약을 구현하는 SQLiteRepository를 추가한다.
