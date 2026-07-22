import type { DatabaseSync } from "node:sqlite";

export function initializeRawItemSchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS raw_items (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      external_id TEXT,
      uri TEXT NOT NULL,
      title TEXT,
      content TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      metadata_json TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS raw_items_source_external_id
      ON raw_items(source_id, external_id)
      WHERE external_id IS NOT NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS raw_items_source_uri_without_external_id
      ON raw_items(source_id, uri)
      WHERE external_id IS NULL;
  `);
}

// UserProfile은 기기당 하나뿐이라 id를 1로 고정한 단일 행 테이블로 저장한다
// (김도현 소유 packages/profile/의 ProfileRepository 계약을 그대로 구현하는
// SQLiteProfileRepository가 사용). CHECK 제약으로 두 번째 행 삽입 자체를 막는다.
export function initializeProfileSchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS user_profile (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      school TEXT NOT NULL,
      major TEXT NOT NULL,
      year TEXT NOT NULL,
      interests_json TEXT NOT NULL,
      activity_types_json TEXT NOT NULL,
      preferred_locations_json TEXT NOT NULL,
      quiet_hours_json TEXT,
      explicit_constraints_json TEXT NOT NULL
    );
  `);
}

export function initializeContextSchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS facts (
      id TEXT PRIMARY KEY,
      raw_item_id TEXT NOT NULL REFERENCES raw_items(id),
      kind TEXT NOT NULL,
      subject TEXT NOT NULL,
      value TEXT NOT NULL,
      event_time TEXT,
      confidence REAL NOT NULL,
      evidence_text TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('active', 'inactive')),
      superseded_at TEXT
    );

    CREATE INDEX IF NOT EXISTS facts_raw_item_status
      ON facts(raw_item_id, status);

    CREATE TABLE IF NOT EXISTS context_items (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      deadline TEXT,
      start_at TEXT,
      end_at TEXT,
      requirements_json TEXT NOT NULL,
      tags_json TEXT NOT NULL,
      priority REAL NOT NULL,
      confidence REAL NOT NULL,
      evidence_ids_json TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS context_items_kind ON context_items(kind);

    CREATE TABLE IF NOT EXISTS evidence (
      id TEXT PRIMARY KEY,
      raw_item_id TEXT NOT NULL REFERENCES raw_items(id),
      source_type TEXT NOT NULL,
      location TEXT NOT NULL,
      quote TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      authority TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS evidence_raw_item ON evidence(raw_item_id);

    CREATE TABLE IF NOT EXISTS context_change_events (
      id TEXT PRIMARY KEY,
      context_item_id TEXT NOT NULL REFERENCES context_items(id),
      change_type TEXT NOT NULL,
      field TEXT,
      previous_value_json TEXT,
      new_value_json TEXT,
      evidence_id TEXT REFERENCES evidence(id),
      changed_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS context_history_context
      ON context_change_events(context_item_id, changed_at);

    CREATE TABLE IF NOT EXISTS recommendations (
      id TEXT PRIMARY KEY,
      context_item_id TEXT NOT NULL REFERENCES context_items(id),
      action TEXT NOT NULL,
      reason TEXT NOT NULL,
      score REAL NOT NULL,
      evidence_ids_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      suppressed_until TEXT
    );

    CREATE INDEX IF NOT EXISTS recommendations_context_created
      ON recommendations(context_item_id, created_at);
  `);
}

// docs/llm-architecture.md §5의 Job Queue 테이블. status/next_run_at 조합으로
// claimNext()가 "지금 처리할 수 있는 작업"을 빠르게 골라야 해서 인덱스를 둔다.
export function initializeJobSchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      input_ref TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'leased', 'done', 'dead_letter')),
      priority INTEGER NOT NULL,
      attempts INTEGER NOT NULL,
      max_attempts INTEGER NOT NULL,
      next_run_at TEXT NOT NULL,
      lease_until TEXT,
      lease_token TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS jobs_claim_idx ON jobs(status, next_run_at);
  `);
}
