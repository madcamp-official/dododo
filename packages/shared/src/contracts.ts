import type {
  ContextItem,
  ContextChangeEvent,
  Evidence,
  Fact,
  Job,
  JobType,
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

export interface EnqueueJobInput {
  id: string;
  type: JobType;
  inputRef: string;
  priority?: number;
  maxAttempts?: number;
  now: Date;
}

export interface JobQueueRepository {
  // 이미 pending/leased 상태인 같은 id가 있으면 아무 것도 하지 않는다(멱등 enqueue) —
  // 같은 RawItem이 여러 tick에서 반복 실패해도 큐에 중복으로 쌓이지 않는다.
  enqueue(input: EnqueueJobInput): Promise<void>;
  // status가 pending이고 nextRunAt <= now인 것 중 주어진 type만, priority 내림차순·
  // nextRunAt 오름차순으로 하나 뽑아 leased로 표시하고 leaseUntil·leaseToken을 설정한
  // 뒤 돌려준다 — 선택(subquery)과 leased 전환을 하나의 원자적 쓰기로 묶어서, 서로
  // 다른 연결(다른 프로세스의 watch/CLI/Electron)이 동시에 호출해도 같은 Job을 둘
  // 이상이 동시에 claim할 수 없다(doyeonid 리뷰 PR #100 P1).
  claimNext(types: JobType[], now: Date, leaseMs: number): Promise<Job | undefined>;
  // leaseToken은 claimNext가 이 Job에 발급한 값과 같아야 반영된다 — 다르면(이미 lease가
  // 만료돼 다른 Worker가 재획득한 뒤 원래 Worker가 뒤늦게 부르는 경우) 아무 것도 바꾸지
  // 않고 false를 반환한다(stale). 실제로 반영됐으면 true를 반환한다 — 호출부(Worker)가
  // 이 값으로 자신의 outcome 집계 여부를 판단한다(doyeonid 리뷰 PR #100 P1).
  complete(id: string, leaseToken: string, now: Date): Promise<boolean>;
  // attempts를 늘리고 status를 pending으로, nextRunAt을 지정한 시각으로 되돌린다.
  // leaseToken 검증과 반환값 의미는 complete와 같다.
  retry(id: string, leaseToken: string, now: Date, nextRunAt: Date, error: string): Promise<boolean>;
  // leaseToken 검증과 반환값 의미는 complete와 같다.
  deadLetter(id: string, leaseToken: string, now: Date, error: string): Promise<boolean>;
  listDeadLetters(): Promise<Job[]>;
  // leaseUntil이 now보다 과거인 leased Job을 pending으로 되돌린다(죽은 Worker 복구).
  // 되돌린 개수를 반환한다.
  recoverExpiredLeases(now: Date): Promise<number>;
}
