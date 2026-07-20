import type {
  ContextItem,
  ContextChangeEvent,
  Evidence,
  Fact,
  RawItem,
  RawItemAnalysisResult,
  Recommendation,
  SourceType,
  UserProfile,
  StoredFact,
} from "./domain.ts";

export interface Collector {
  readonly sourceId: string;
  readonly sourceType: SourceType;
  sync(): Promise<RawItem[]>;
}

export interface PrivacyGateway {
  prepare(rawItem: RawItem): Promise<RawItem>;
}

export interface FactExtractor {
  extract(rawItem: RawItem): Promise<Fact[]>;
}

export interface ContextResolver {
  resolve(facts: Fact[], existing: ContextItem[]): Promise<ContextItem[]>;
}

export interface ContextRepository {
  saveRawItems(items: RawItem[]): Promise<void>;
  saveFacts(facts: Fact[]): Promise<void>;
  saveContextItems(items: ContextItem[]): Promise<void>;
  listContextItems(kind?: ContextItem["kind"]): Promise<ContextItem[]>;
  findContextItem(id: string): Promise<ContextItem | undefined>;
  listFactsByRawItemId(
    rawItemId: string,
    options?: { includeInactive?: boolean },
  ): Promise<StoredFact[]>;
  deactivateFactsByRawItemId(rawItemId: string, deactivatedAt: string): Promise<void>;
  saveEvidence(evidence: Evidence[]): Promise<void>;
  listEvidence(ids: string[]): Promise<Evidence[]>;
  listEvidenceByContextItemId(contextItemId: string): Promise<Evidence[]>;
  saveContextHistory(events: ContextChangeEvent[]): Promise<void>;
  listContextHistory(contextItemId: string): Promise<ContextChangeEvent[]>;
  saveRecommendations(recommendations: Recommendation[]): Promise<void>;
  listRecommendations(contextItemId?: string): Promise<Recommendation[]>;
  saveRawItemAnalysis(result: RawItemAnalysisResult): Promise<void>;
}

export interface RecommendationEngine {
  recommend(
    items: ContextItem[],
    profile: UserProfile,
    now: Date,
  ): Promise<Recommendation[]>;
}

export interface ProfileRepository {
  get(): Promise<UserProfile | undefined>;
  save(profile: UserProfile): Promise<void>;
}

export interface Notifier {
  send(recommendation: Recommendation): Promise<void>;
}
