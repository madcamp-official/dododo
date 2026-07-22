export type SourceType =
  | "school-site"
  | "school-email"
  | "lms"
  | "file"
  | "calendar"
  | "screen"
  | "conversation";

export type ContextKind =
  | "opportunity"
  | "task"
  | "event"
  | "note"
  | "activity";

export type FactKind =
  | "opportunity"
  | "task"
  | "deadline"
  | "event"
  | "requirement"
  | "note"
  | "activity"
  | "status";

export type ContextStatus =
  | "candidate"
  | "new"
  | "recommended"
  | "saved"
  | "preparing"
  | "applied"
  | "dismissed"
  | "expired"
  | "todo"
  | "in_progress"
  | "done"
  | "cancelled"
  | "confirmed";

export interface Source {
  id: string;
  type: SourceType;
  name: string;
  enabled: boolean;
  lastSyncedAt?: string;
  config: Record<string, unknown>;
}

export interface RawItem {
  id: string;
  sourceId: string;
  sourceType: SourceType;
  externalId?: string;
  uri: string;
  title?: string;
  content: string;
  contentHash: string;
  observedAt: string;
  metadata: Record<string, unknown>;
}

export interface Fact {
  id: string;
  rawItemId: string;
  kind: FactKind;
  subject: string;
  value: string;
  eventTime?: string;
  confidence: number;
  evidenceText: string;
}

export type StoredFactStatus = "active" | "inactive";

// FactExtractor의 출력은 저장소 생명주기를 알 필요가 없다. 활성/비활성 상태는
// 저장된 Fact를 조회할 때만 노출한다.
export interface StoredFact extends Fact {
  status: StoredFactStatus;
  supersededAt?: string;
}

export interface Evidence {
  id: string;
  rawItemId: string;
  sourceType: SourceType;
  location: string;
  quote: string;
  observedAt: string;
  authority: "official" | "user" | "derived" | "observation";
}

export interface ContextItem {
  id: string;
  kind: ContextKind;
  title: string;
  status: ContextStatus;
  deadline?: string;
  startAt?: string;
  endAt?: string;
  requirements: string[];
  tags: string[];
  priority: number;
  confidence: number;
  evidenceIds: string[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface Recommendation {
  id: string;
  contextItemId: string;
  action: string;
  reason: string;
  score: number;
  evidenceIds: string[];
  createdAt: string;
  suppressedUntil?: string;
}

export type ContextChangeType =
  | "created"
  | "field_updated"
  | "status_changed"
  | "merged"
  | "evidence_added";

export interface ContextChangeEvent {
  id: string;
  contextItemId: string;
  changeType: ContextChangeType;
  field?: string;
  previousValue?: unknown;
  newValue?: unknown;
  evidenceId?: string;
  changedAt: string;
}

// RawItem 하나에서 파생된 분석 결과의 원자적 저장 단위다. Repository 구현은
// 전부 반영하거나 전혀 반영하지 않아야 한다.
export interface RawItemAnalysisResult {
  rawItem: RawItem;
  facts: Fact[];
  contextItems: ContextItem[];
  evidence: Evidence[];
  history: ContextChangeEvent[];
  recommendations?: Recommendation[];
  analyzedAt: string;
}

export interface UserProfile {
  school: string;
  major: string;
  year: string;
  interests: string[];
  activityTypes: string[];
  preferredLocations: string[];
  quietHours?: { start: string; end: string };
  explicitConstraints: string[];
}

export interface SyncResult {
  sourceId: string;
  collected: number;
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
}

// docs/llm-architecture.md §5: 클라이언트 측 백그라운드 재분석 Job Queue. 지금은
// extract_facts만 실제로 큐를 타고(apps/cli/src/runtime/jobQueue/), 나머지 타입은
// 앞으로 같은 큐에 붙일 작업 종류를 미리 정해 둔 것이다(§5 원본 목록 그대로).
export type JobType =
  | "extract_facts"
  | "generate_embedding"
  | "resolve_context"
  | "review_ambiguous_merge"
  | "recalculate_relevance"
  | "recalculate_priority"
  | "generate_daily_plan"
  | "analyze_screen"
  | "generate_advice"
  | "reprocess_failed";

// pending: 실행 대기(nextRunAt 도래 전일 수도 있음). leased: Worker가 지금 처리 중
// (leaseUntil까지). done: 성공. dead_letter: maxAttempts를 다 써서 더 이상 재시도하지
// 않음(사람이 봐야 하는 영구 실패).
export type JobStatus = "pending" | "leased" | "done" | "dead_letter";

export interface Job {
  // 호출부가 결정적으로 만든다(예: `extract_facts:${rawItemId}`) — 같은 작업을
  // 중복 enqueue해도 하나만 남는다(멱등).
  id: string;
  type: JobType;
  // 작업 대상을 가리키는 참조(예: RawItem id). 어떤 문자열을 참조로 쓸지는 Job.type별
  // Handler가 정한다 — Job 자체는 의미를 모른다.
  inputRef: string;
  status: JobStatus;
  priority: number;
  attempts: number;
  maxAttempts: number;
  nextRunAt: string;
  leaseUntil?: string;
  // doyeonid 리뷰(PR #100) P1: claim마다 새로 발급하는 소유권 토큰. complete/retry/
  // deadLetter는 이 토큰이 지금 저장된 값과 같을 때만 반영된다 — lease가 만료돼
  // 다른 Worker가 재획득한 뒤, 원래 Worker가 뒤늦게 끝내며 그 결과를 반영하려 해도
  // (stale completion) 토큰이 안 맞아 조용히 무시된다. leased 상태일 때만 값이 있다.
  leaseToken?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}
