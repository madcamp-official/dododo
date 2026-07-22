import type { EnqueueJobInput, Job, JobQueueRepository, JobType } from "../../shared/src/index.ts";

const DEFAULT_MAX_ATTEMPTS = 5;

export class InMemoryJobQueueRepository implements JobQueueRepository {
  private readonly jobs = new Map<string, Job>();

  async enqueue(input: EnqueueJobInput): Promise<void> {
    const existing = this.jobs.get(input.id);
    if (existing !== undefined && (existing.status === "pending" || existing.status === "leased")) {
      return;
    }

    const nowIso = input.now.toISOString();
    this.jobs.set(input.id, {
      id: input.id,
      type: input.type,
      inputRef: input.inputRef,
      status: "pending",
      priority: input.priority ?? 0,
      attempts: 0,
      maxAttempts: input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      nextRunAt: nowIso,
      leaseUntil: undefined,
      lastError: undefined,
      createdAt: existing?.createdAt ?? nowIso,
      updatedAt: nowIso,
    });
  }

  async claimNext(types: JobType[], now: Date, leaseMs: number): Promise<Job | undefined> {
    const typeSet = new Set(types);
    const candidates = [...this.jobs.values()]
      .filter((job) => job.status === "pending" && typeSet.has(job.type) && job.nextRunAt <= now.toISOString())
      .sort((a, b) => b.priority - a.priority || (a.nextRunAt < b.nextRunAt ? -1 : 1));

    const candidate = candidates[0];
    if (candidate === undefined) return undefined;

    const updated: Job = {
      ...candidate,
      status: "leased",
      leaseUntil: new Date(now.getTime() + leaseMs).toISOString(),
      updatedAt: now.toISOString(),
    };
    this.jobs.set(updated.id, updated);
    return structuredClone(updated);
  }

  async complete(id: string, now: Date): Promise<void> {
    const job = this.jobs.get(id);
    if (job === undefined) return;
    this.jobs.set(id, { ...job, status: "done", leaseUntil: undefined, updatedAt: now.toISOString() });
  }

  async retry(id: string, now: Date, nextRunAt: Date, error: string): Promise<void> {
    const job = this.jobs.get(id);
    if (job === undefined) return;
    this.jobs.set(id, {
      ...job,
      status: "pending",
      attempts: job.attempts + 1,
      nextRunAt: nextRunAt.toISOString(),
      leaseUntil: undefined,
      lastError: error,
      updatedAt: now.toISOString(),
    });
  }

  async deadLetter(id: string, now: Date, error: string): Promise<void> {
    const job = this.jobs.get(id);
    if (job === undefined) return;
    this.jobs.set(id, {
      ...job,
      status: "dead_letter",
      attempts: job.attempts + 1,
      leaseUntil: undefined,
      lastError: error,
      updatedAt: now.toISOString(),
    });
  }

  async listDeadLetters(): Promise<Job[]> {
    return [...this.jobs.values()].filter((job) => job.status === "dead_letter").map((job) => structuredClone(job));
  }

  async recoverExpiredLeases(now: Date): Promise<number> {
    let recovered = 0;
    for (const [id, job] of this.jobs) {
      if (job.status !== "leased" || job.leaseUntil === undefined || job.leaseUntil >= now.toISOString()) continue;
      this.jobs.set(id, { ...job, status: "pending", leaseUntil: undefined, updatedAt: now.toISOString() });
      recovered += 1;
    }
    return recovered;
  }
}
