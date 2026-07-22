import { randomUUID } from "node:crypto";
import type { DatabaseSync, StatementSync } from "node:sqlite";

import type { EnqueueJobInput, JobQueueRepository } from "../../../shared/src/index.ts";
import type { Job, JobStatus, JobType } from "../../../shared/src/index.ts";

export class SQLiteJobQueueRepository implements JobQueueRepository {
  private readonly database: DatabaseSync;
  private readonly findByIdStatement: StatementSync;
  private readonly insertStatement: StatementSync;
  private readonly completeStatement: StatementSync;
  private readonly retryStatement: StatementSync;
  private readonly deadLetterStatement: StatementSync;
  private readonly listDeadLettersStatement: StatementSync;

  constructor(database: DatabaseSync) {
    this.database = database;
    this.findByIdStatement = database.prepare(`${SELECT_JOB} WHERE id = ?`);
    this.insertStatement = database.prepare(`
      INSERT INTO jobs (
        id, type, input_ref, status, priority, attempts, max_attempts,
        next_run_at, lease_until, lease_token, last_error, created_at, updated_at
      ) VALUES (?, ?, ?, 'pending', ?, 0, ?, ?, NULL, NULL, NULL, ?, ?)
    `);
    // doyeonid 리뷰(PR #100) P1: leaseToken이 claim 당시 발급한 값과 같을 때만
    // 반영한다(WHERE에 lease_token = ? 포함) — lease 만료 후 다른 Worker가 재획득한
    // 뒤 원래 Worker가 뒤늦게 완료·재시도·Dead Letter를 시도해도(stale) 토큰이
    // 안 맞아 0행만 바뀌고 조용히 무시된다.
    this.completeStatement = database.prepare(`
      UPDATE jobs SET status = 'done', lease_until = NULL, lease_token = NULL, updated_at = ?
      WHERE id = ? AND status = 'leased' AND lease_token = ?
    `);
    this.retryStatement = database.prepare(`
      UPDATE jobs
      SET status = 'pending', attempts = attempts + 1, next_run_at = ?,
          lease_until = NULL, lease_token = NULL, last_error = ?, updated_at = ?
      WHERE id = ? AND status = 'leased' AND lease_token = ?
    `);
    this.deadLetterStatement = database.prepare(`
      UPDATE jobs
      SET status = 'dead_letter', attempts = attempts + 1, lease_until = NULL,
          lease_token = NULL, last_error = ?, updated_at = ?
      WHERE id = ? AND status = 'leased' AND lease_token = ?
    `);
    this.listDeadLettersStatement = database.prepare(`${SELECT_JOB} WHERE status = 'dead_letter'`);
  }

  async enqueue(input: EnqueueJobInput): Promise<void> {
    const existing = await this.findById(input.id);
    // 이미 pending/leased(아직 끝나지 않은 작업)면 다시 만들지 않는다 — 같은 RawItem이
    // 여러 tick에서 반복 실패해도 큐에 중복으로 쌓이지 않는다(멱등 enqueue). done/
    // dead_letter로 끝난 뒤 같은 id로 다시 enqueue되면(예: reprocess_failed 재시도
    // 요청) 새 작업으로 취급해 다시 넣는다.
    if (existing !== undefined && (existing.status === "pending" || existing.status === "leased")) {
      return;
    }

    const nowIso = input.now.toISOString();
    if (existing === undefined) {
      this.insertStatement.run(
        input.id,
        input.type,
        input.inputRef,
        input.priority ?? 0,
        input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
        nowIso,
        nowIso,
        nowIso,
      );
    } else {
      this.database.prepare(`
        UPDATE jobs
        SET type = ?, input_ref = ?, status = 'pending', priority = ?, attempts = 0,
            max_attempts = ?, next_run_at = ?, lease_until = NULL, lease_token = NULL,
            last_error = NULL, updated_at = ?
        WHERE id = ?
      `).run(
        input.type,
        input.inputRef,
        input.priority ?? 0,
        input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
        nowIso,
        nowIso,
        input.id,
      );
    }
  }

  async claimNext(types: JobType[], now: Date, leaseMs: number): Promise<Job | undefined> {
    if (types.length === 0) return undefined;

    const placeholders = types.map(() => "?").join(", ");
    const nowIso = now.toISOString();
    const leaseUntil = new Date(now.getTime() + leaseMs).toISOString();
    const leaseToken = randomUUID();

    // doyeonid 리뷰(PR #100) P1: 후보 선택(subquery)과 leased 전환을 하나의 UPDATE
    // 문으로 묶어 원자적으로 처리한다. 바깥 WHERE에도 status = 'pending'을 다시
    // 확인하므로, 다른 연결이 그 사이 먼저 이 행을 leased로 바꿔버렸으면(SQLite의
    // 쓰기 트랜잭션은 연결 간에 직렬화된다) 이 UPDATE는 0행을 바꾸고 끝난다 — RETURNING이
    // 아무 것도 안 돌려주므로 undefined가 되어 같은 Job을 두 연결이 동시에 처리하지
    // 않는다.
    const row = this.database.prepare(`
      UPDATE jobs
      SET status = 'leased', lease_until = ?, lease_token = ?, updated_at = ?
      WHERE status = 'pending' AND id = (
        SELECT id FROM jobs
        WHERE status = 'pending' AND next_run_at <= ? AND type IN (${placeholders})
        ORDER BY priority DESC, next_run_at ASC
        LIMIT 1
      )
      RETURNING id, type, input_ref, status, priority, attempts, max_attempts,
                next_run_at, lease_until, lease_token, last_error, created_at, updated_at
    `).get(leaseUntil, leaseToken, nowIso, nowIso, ...types) as JobRow | undefined;

    return row === undefined ? undefined : rowToJob(row);
  }

  async complete(id: string, leaseToken: string, now: Date): Promise<void> {
    this.completeStatement.run(now.toISOString(), id, leaseToken);
  }

  async retry(id: string, leaseToken: string, now: Date, nextRunAt: Date, error: string): Promise<void> {
    this.retryStatement.run(nextRunAt.toISOString(), error, now.toISOString(), id, leaseToken);
  }

  async deadLetter(id: string, leaseToken: string, now: Date, error: string): Promise<void> {
    this.deadLetterStatement.run(error, now.toISOString(), id, leaseToken);
  }

  async listDeadLetters(): Promise<Job[]> {
    const rows = this.listDeadLettersStatement.all() as unknown as JobRow[];
    return rows.map(rowToJob);
  }

  async recoverExpiredLeases(now: Date): Promise<number> {
    const nowIso = now.toISOString();
    const result = this.database.prepare(`
      UPDATE jobs
      SET status = 'pending', lease_until = NULL, lease_token = NULL, updated_at = ?
      WHERE status = 'leased' AND lease_until < ?
    `).run(nowIso, nowIso);
    return Number(result.changes);
  }

  private async findById(id: string): Promise<Job | undefined> {
    const row = this.findByIdStatement.get(id) as JobRow | undefined;
    return row === undefined ? undefined : rowToJob(row);
  }
}

const DEFAULT_MAX_ATTEMPTS = 5;

const SELECT_JOB = `
  SELECT id, type, input_ref, status, priority, attempts, max_attempts,
         next_run_at, lease_until, lease_token, last_error, created_at, updated_at
  FROM jobs
`;

interface JobRow {
  id: string;
  type: string;
  input_ref: string;
  status: string;
  priority: number;
  attempts: number;
  max_attempts: number;
  next_run_at: string;
  lease_until: string | null;
  lease_token: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

function rowToJob(row: JobRow): Job {
  return {
    id: row.id,
    type: row.type as JobType,
    inputRef: row.input_ref,
    status: row.status as JobStatus,
    priority: row.priority,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    nextRunAt: row.next_run_at,
    leaseUntil: row.lease_until ?? undefined,
    leaseToken: row.lease_token ?? undefined,
    lastError: row.last_error ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
