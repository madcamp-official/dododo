import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryJobQueueRepository } from "../packages/storage/src/index.ts";
import { runDueJobs } from "../apps/cli/src/runtime/jobQueue/worker.ts";
import type { Job, JobQueueRepository, JobType } from "../packages/shared/src/index.ts";

const NOW = new Date("2026-07-22T10:00:00Z");

// doyeonid 리뷰(PR #100) P1(2차)를 재현: lease 만료 후 다른 Worker가 이미 재획득해
// complete/retry/deadLetter가 false(stale, 아무 것도 안 바뀜)를 반환하는 상황을
// 실제 저장소 대신 이 fake로 강제한다 — Worker가 반환값을 무시하고 무조건
// outcome에 담으면 이 fake에서도 실패해야 한다.
function createStaleQueue(job: Job): JobQueueRepository {
  let claimed = false;
  return {
    async enqueue() {},
    async claimNext(): Promise<Job | undefined> {
      if (claimed) return undefined;
      claimed = true;
      return job;
    },
    async complete(): Promise<boolean> {
      return false;
    },
    async retry(): Promise<boolean> {
      return false;
    },
    async deadLetter(): Promise<boolean> {
      return false;
    },
    async listDeadLetters(): Promise<Job[]> {
      return [];
    },
    async recoverExpiredLeases(): Promise<number> {
      return 0;
    },
  };
}

function makeLeasedJob(type: JobType, overrides: Partial<Job> = {}): Job {
  return {
    id: "job-1",
    type,
    inputRef: "raw-1",
    status: "leased",
    priority: 0,
    attempts: 0,
    maxAttempts: 5,
    nextRunAt: NOW.toISOString(),
    leaseUntil: new Date(NOW.getTime() + 60_000).toISOString(),
    leaseToken: "token-a",
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides,
  };
}

test("complete가 stale(false)을 반환하면 handler가 성공해도 completed에 담기지 않는다", async () => {
  const queue = createStaleQueue(makeLeasedJob("extract_facts"));

  const outcome = await runDueJobs(queue, {
    extract_facts: async () => {},
  }, NOW);

  assert.deepEqual(outcome, { completed: [], retried: [], deadLettered: [] });
});

test("retry가 stale(false)을 반환하면 재시도 가능한 실패도 retried에 담기지 않는다", async () => {
  const queue = createStaleQueue(makeLeasedJob("extract_facts", { maxAttempts: 5 }));

  const outcome = await runDueJobs(queue, {
    extract_facts: async () => {
      throw new Error("일시적 오류");
    },
  }, NOW);

  assert.deepEqual(outcome, { completed: [], retried: [], deadLettered: [] });
});

test("deadLetter가 stale(false)을 반환하면 영구 실패도 deadLettered에 담기지 않는다", async () => {
  const queue = createStaleQueue(makeLeasedJob("extract_facts", { maxAttempts: 1 }));

  const outcome = await runDueJobs(queue, {
    extract_facts: async () => {
      throw new Error("영구 실패");
    },
  }, NOW);

  assert.deepEqual(outcome, { completed: [], retried: [], deadLettered: [] });
});

test("성공하면 completed에 담기고 큐에서 완료 처리된다", async () => {
  const queue = new InMemoryJobQueueRepository();
  await queue.enqueue({ id: "job-1", type: "extract_facts", inputRef: "raw-1", now: NOW });

  const outcome = await runDueJobs(queue, {
    extract_facts: async () => {},
  }, NOW);

  assert.deepEqual(outcome, { completed: ["job-1"], retried: [], deadLettered: [] });
  assert.equal(await queue.claimNext(["extract_facts"], NOW, 60_000), undefined);
});

test("일반 Error(분류 정보 없음)로 실패하면 재시도 가능으로 보고 backoff 후 retried에 담긴다", async () => {
  const queue = new InMemoryJobQueueRepository();
  await queue.enqueue({ id: "job-1", type: "extract_facts", inputRef: "raw-1", maxAttempts: 5, now: NOW });

  const outcome = await runDueJobs(queue, {
    extract_facts: async () => {
      throw new Error("일시적 오류");
    },
  }, NOW);

  assert.deepEqual(outcome, { completed: [], retried: ["job-1"], deadLettered: [] });

  // 30초(첫 backoff) 전에는 아직 안 뽑힌다.
  const tooEarly = await queue.claimNext(["extract_facts"], new Date(NOW.getTime() + 10_000), 60_000);
  assert.equal(tooEarly, undefined);
  const due = await queue.claimNext(["extract_facts"], new Date(NOW.getTime() + 31_000), 60_000);
  assert.equal(due?.attempts, 1);
});

test("maxAttempts에 도달하면 재시도 대신 dead-letter로 보낸다", async () => {
  const queue = new InMemoryJobQueueRepository();
  await queue.enqueue({ id: "job-1", type: "extract_facts", inputRef: "raw-1", maxAttempts: 1, now: NOW });

  const outcome = await runDueJobs(queue, {
    extract_facts: async () => {
      throw new Error("계속 실패");
    },
  }, NOW);

  assert.equal(outcome.retried.length, 0);
  assert.equal(outcome.deadLettered.length, 1);
  assert.equal(outcome.deadLettered[0]?.id, "job-1");
  assert.equal(outcome.deadLettered[0]?.type, "extract_facts");
  assert.equal(outcome.deadLettered[0]?.lastError, "계속 실패");

  const deadLetters = await queue.listDeadLetters();
  assert.equal(deadLetters.length, 1);
});

test("retryable:false로 분류된 오류는 attempts가 남아 있어도 즉시 dead-letter된다", async () => {
  const queue = new InMemoryJobQueueRepository();
  await queue.enqueue({ id: "job-1", type: "extract_facts", inputRef: "raw-1", maxAttempts: 5, now: NOW });

  const outcome = await runDueJobs(queue, {
    extract_facts: async () => {
      throw Object.assign(new Error("영구 실패"), { retryable: false });
    },
  }, NOW);

  assert.equal(outcome.retried.length, 0);
  assert.equal(outcome.deadLettered.length, 1);
});

test("maxJobsPerRun을 넘는 작업은 이번 run에서 처리하지 않는다", async () => {
  const queue = new InMemoryJobQueueRepository();
  await queue.enqueue({ id: "job-1", type: "extract_facts", inputRef: "a", now: NOW });
  await queue.enqueue({ id: "job-2", type: "extract_facts", inputRef: "b", now: NOW });
  await queue.enqueue({ id: "job-3", type: "extract_facts", inputRef: "c", now: NOW });

  const processed: string[] = [];
  const outcome = await runDueJobs(queue, {
    extract_facts: async (inputRef) => {
      processed.push(inputRef);
    },
  }, NOW, { maxJobsPerRun: 2 });

  assert.equal(outcome.completed.length, 2);
  assert.equal(processed.length, 2);
});

test("handlers가 없는 type이면 아무 것도 하지 않는다", async () => {
  const queue = new InMemoryJobQueueRepository();
  const outcome = await runDueJobs(queue, {}, NOW);
  assert.deepEqual(outcome, { completed: [], retried: [], deadLettered: [] });
});

test("죽은 Worker가 남긴 만료된 lease를 이번 run에서 복구해 다시 처리한다", async () => {
  const queue = new InMemoryJobQueueRepository();
  await queue.enqueue({ id: "job-1", type: "extract_facts", inputRef: "a", now: NOW });
  // 죽은 Worker를 흉내: 짧은 lease로 claim만 하고 완료 처리는 하지 않는다.
  await queue.claimNext(["extract_facts"], NOW, 1_000);

  const later = new Date(NOW.getTime() + 5_000);
  const outcome = await runDueJobs(queue, {
    extract_facts: async () => {},
  }, later);

  assert.deepEqual(outcome.completed, ["job-1"]);
});
