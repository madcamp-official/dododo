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
