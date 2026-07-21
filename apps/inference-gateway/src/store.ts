import { createHash, randomBytes, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import type {
  InferenceJobError,
  InferenceJobResponse,
  InferenceJobStatus,
  RemoteInferenceRequest,
} from "../../../packages/context-engine/src/index.ts";

export interface StoredInferenceJob {
  id: string;
  ownerTokenHash: string;
  status: InferenceJobStatus;
  request?: RemoteInferenceRequest;
  result?: unknown;
  error?: InferenceJobError;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export type ActivationResult =
  | { status: "activated"; token: string }
  | { status: "already_used" };

export type JobAdmissionResult =
  | { status: "created"; job: StoredInferenceJob }
  | { status: "queue_full" }
  | { status: "daily_quota_exceeded" };

export class GatewayStore {
  private readonly database: DatabaseSync;

  constructor(path: string) {
    this.database = new DatabaseSync(path);
    this.database.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
    this.initializeSchema();
  }

  close(): void {
    this.database.close();
  }

  recoverInterruptedJobs(now: string): void {
    this.database.prepare(`
      UPDATE gateway_jobs
      SET status = 'queued', updated_at = ?
      WHERE status = 'running'
    `).run(now);
  }

  isDeviceTokenActive(tokenHash: string): boolean {
    const row = this.database.prepare(`
      SELECT token_hash FROM gateway_device_tokens
      WHERE token_hash = ? AND revoked_at IS NULL
    `).get(tokenHash);
    return row !== undefined;
  }

  activate(codeHash: string, deviceName: string | undefined, now: string): ActivationResult {
    const existing = this.database.prepare(
      "SELECT code_hash FROM gateway_activations WHERE code_hash = ?",
    ).get(codeHash);
    if (existing !== undefined) return { status: "already_used" };

    const token = `dodo_${randomBytes(32).toString("base64url")}`;
    const tokenHash = hashSecret(token);
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const raced = this.database.prepare(
        "SELECT code_hash FROM gateway_activations WHERE code_hash = ?",
      ).get(codeHash);
      if (raced !== undefined) {
        this.database.exec("ROLLBACK");
        return { status: "already_used" };
      }

      this.database.prepare(`
        INSERT INTO gateway_device_tokens(token_hash, device_name, created_at)
        VALUES (?, ?, ?)
      `).run(tokenHash, deviceName ?? null, now);
      this.database.prepare(`
        INSERT INTO gateway_activations(code_hash, token_hash, activated_at)
        VALUES (?, ?, ?)
      `).run(codeHash, tokenHash, now);
      this.database.exec("COMMIT");
      return { status: "activated", token };
    } catch (error) {
      if (this.database.isTransaction) this.database.exec("ROLLBACK");
      throw error;
    }
  }

  admitJob(
    ownerTokenHash: string,
    request: RemoteInferenceRequest,
    createdAt: string,
    expiresAt: string,
    maxActiveJobs: number,
    usageDay: string,
    dailyLimit: number,
  ): JobAdmissionResult {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const active = this.database.prepare(`
        SELECT COUNT(*) AS count
        FROM gateway_jobs
        WHERE status IN ('queued', 'running')
      `).get() as { count: number };
      if (Number(active.count) >= maxActiveJobs) {
        this.database.exec("ROLLBACK");
        return { status: "queue_full" };
      }

      const usage = this.database.prepare(`
        SELECT jobs_created FROM gateway_daily_usage
        WHERE owner_token_hash = ? AND usage_day = ?
      `).get(ownerTokenHash, usageDay) as { jobs_created: number } | undefined;
      if ((usage?.jobs_created ?? 0) >= dailyLimit) {
        this.database.exec("ROLLBACK");
        return { status: "daily_quota_exceeded" };
      }
      this.database.prepare(`
        INSERT INTO gateway_daily_usage(owner_token_hash, usage_day, jobs_created)
        VALUES (?, ?, 1)
        ON CONFLICT(owner_token_hash, usage_day)
        DO UPDATE SET jobs_created = jobs_created + 1
      `).run(ownerTokenHash, usageDay);

      const job = this.insertJob(ownerTokenHash, request, createdAt, expiresAt);
      this.database.exec("COMMIT");
      return { status: "created", job };
    } catch (error) {
      if (this.database.isTransaction) this.database.exec("ROLLBACK");
      throw error;
    }
  }

  private insertJob(
    ownerTokenHash: string,
    request: RemoteInferenceRequest,
    createdAt: string,
    expiresAt: string,
  ): StoredInferenceJob {
    const id = `job_${randomUUID().replaceAll("-", "")}`;
    this.database.prepare(`
      INSERT INTO gateway_jobs(
        id, owner_token_hash, status, request_json, created_at, updated_at, expires_at
      ) VALUES (?, ?, 'queued', ?, ?, ?, ?)
    `).run(id, ownerTokenHash, JSON.stringify(request), createdAt, createdAt, expiresAt);
    return {
      id,
      ownerTokenHash,
      status: "queued",
      request,
      createdAt,
      updatedAt: createdAt,
      expiresAt,
    };
  }

  claimNextQueuedJob(now: string): StoredInferenceJob | undefined {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const row = this.database.prepare(`
        SELECT * FROM gateway_jobs
        WHERE status = 'queued' AND expires_at > ?
        ORDER BY created_at ASC
        LIMIT 1
      `).get(now) as JobRow | undefined;
      if (row === undefined) {
        this.database.exec("COMMIT");
        return undefined;
      }
      this.database.prepare(`
        UPDATE gateway_jobs SET status = 'running', updated_at = ?
        WHERE id = ? AND status = 'queued'
      `).run(now, row.id);
      this.database.exec("COMMIT");
      return rowToJob({ ...row, status: "running", updated_at: now });
    } catch (error) {
      if (this.database.isTransaction) this.database.exec("ROLLBACK");
      throw error;
    }
  }

  succeedJob(id: string, result: unknown, now: string): void {
    this.database.prepare(`
      UPDATE gateway_jobs
      SET status = 'succeeded', result_json = ?, request_json = NULL,
          error_json = NULL, updated_at = ?
      WHERE id = ? AND status = 'running'
    `).run(JSON.stringify(result), now, id);
  }

  failJob(id: string, error: InferenceJobError, now: string): void {
    this.database.prepare(`
      UPDATE gateway_jobs
      SET status = 'failed', error_json = ?, request_json = NULL,
          result_json = NULL, updated_at = ?
      WHERE id = ? AND status = 'running'
    `).run(JSON.stringify(error), now, id);
  }

  findOwnedJob(id: string, ownerTokenHash: string): StoredInferenceJob | undefined {
    const row = this.database.prepare(`
      SELECT * FROM gateway_jobs WHERE id = ? AND owner_token_hash = ?
    `).get(id, ownerTokenHash) as JobRow | undefined;
    return row === undefined ? undefined : rowToJob(row);
  }

  findJob(id: string): StoredInferenceJob | undefined {
    const row = this.database.prepare("SELECT * FROM gateway_jobs WHERE id = ?").get(id) as JobRow | undefined;
    return row === undefined ? undefined : rowToJob(row);
  }

  cancelOwnedJob(id: string, ownerTokenHash: string, now: string): StoredInferenceJob | undefined {
    const existing = this.findOwnedJob(id, ownerTokenHash);
    if (existing === undefined) return undefined;
    if (existing.status === "queued" || existing.status === "running") {
      this.database.prepare(`
        UPDATE gateway_jobs
        SET status = 'cancelled', request_json = NULL, result_json = NULL,
            error_json = NULL, updated_at = ?
        WHERE id = ? AND owner_token_hash = ?
      `).run(now, id, ownerTokenHash);
      return this.findOwnedJob(id, ownerTokenHash);
    }
    return existing;
  }

  deleteExpired(now: string): number {
    const result = this.database.prepare("DELETE FROM gateway_jobs WHERE expires_at <= ?").run(now);
    return Number(result.changes);
  }

  toResponse(job: StoredInferenceJob, pollAfterMs: number): InferenceJobResponse {
    return {
      jobId: job.id,
      status: job.status,
      ...(job.status === "queued" || job.status === "running" ? { pollAfterMs } : {}),
      ...(job.status === "succeeded" ? { result: job.result } : {}),
      ...(job.status === "failed" ? { error: job.error } : {}),
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      expiresAt: job.expiresAt,
    };
  }

  private initializeSchema(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS gateway_device_tokens (
        token_hash TEXT PRIMARY KEY,
        device_name TEXT,
        created_at TEXT NOT NULL,
        revoked_at TEXT
      );

      CREATE TABLE IF NOT EXISTS gateway_activations (
        code_hash TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL REFERENCES gateway_device_tokens(token_hash),
        activated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS gateway_daily_usage (
        owner_token_hash TEXT NOT NULL,
        usage_day TEXT NOT NULL,
        jobs_created INTEGER NOT NULL,
        PRIMARY KEY(owner_token_hash, usage_day)
      );

      CREATE TABLE IF NOT EXISTS gateway_jobs (
        id TEXT PRIMARY KEY,
        owner_token_hash TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
        request_json TEXT,
        result_json TEXT,
        error_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS gateway_jobs_queue
        ON gateway_jobs(status, created_at);
      CREATE INDEX IF NOT EXISTS gateway_jobs_expiry
        ON gateway_jobs(expires_at);
    `);
  }
}

interface JobRow {
  id: string;
  owner_token_hash: string;
  status: InferenceJobStatus;
  request_json: string | null;
  result_json: string | null;
  error_json: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string;
}

function rowToJob(row: JobRow): StoredInferenceJob {
  return {
    id: row.id,
    ownerTokenHash: row.owner_token_hash,
    status: row.status,
    ...(row.request_json === null ? {} : { request: JSON.parse(row.request_json) as RemoteInferenceRequest }),
    ...(row.result_json === null ? {} : { result: JSON.parse(row.result_json) as unknown }),
    ...(row.error_json === null ? {} : { error: JSON.parse(row.error_json) as InferenceJobError }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
  };
}

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}
