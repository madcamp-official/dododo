import type { JobQueueRepository, JobType } from "../../../../../packages/shared/src/index.ts";
import { computeBackoffDelayMs } from "./backoff.ts";

export type JobHandler = (inputRef: string, now: Date) => Promise<void>;

export interface JobWorkerOptions {
  // 죽은 Worker가 leased 상태로 영원히 잡아두지 않도록 리스 만료 시간을 둔다.
  leaseMs?: number;
  // 한 번의 drain 호출에서 처리할 최대 작업 수 — watch tick 하나가 큐 밀린 작업을
  // 전부 처리하느라 오래 걸리지 않게 한다.
  maxJobsPerRun?: number;
}

export interface DeadLetteredJob {
  id: string;
  type: JobType;
  inputRef: string;
  lastError: string;
}

export interface JobRunOutcome {
  completed: string[];
  retried: string[];
  deadLettered: DeadLetteredJob[];
}

const DEFAULT_LEASE_MS = 5 * 60_000;
const DEFAULT_MAX_JOBS_PER_RUN = 5;

// docs/llm-architecture.md §5: Job Queue → Worker → 재시도/Backoff/Dead Letter.
// Job.type별 실제 처리 로직(handlers)은 호출부가 주입한다 — 이 함수는 claim·재시도
// 판정·완료 처리라는 오케스트레이션만 담당해서, extract_facts 외의 다른 Job.type이
// 늘어나도 handlers만 추가하면 그대로 재사용된다.
export async function runDueJobs(
  queue: JobQueueRepository,
  handlers: Partial<Record<JobType, JobHandler>>,
  now: Date,
  options: JobWorkerOptions = {},
): Promise<JobRunOutcome> {
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
  const maxJobsPerRun = options.maxJobsPerRun ?? DEFAULT_MAX_JOBS_PER_RUN;
  const types = Object.keys(handlers) as JobType[];
  const outcome: JobRunOutcome = { completed: [], retried: [], deadLettered: [] };
  if (types.length === 0) return outcome;

  // 죽은 Worker가 leased로 묶어 둔 작업을 먼저 되돌려 이번 tick에 다시 claim될 수
  // 있게 한다(leaseUntil 기반 복구, §5).
  await queue.recoverExpiredLeases(now);

  for (let index = 0; index < maxJobsPerRun; index += 1) {
    const job = await queue.claimNext(types, now, leaseMs);
    if (job === undefined) break;
    // claimNext는 leased로 만든 Job에 항상 leaseToken을 채워 돌려준다 — 없으면
    // 저장소 구현이 계약을 어긴 것이라 이 Job은 건드리지 않고 건너뛴다.
    const leaseToken = job.leaseToken;
    if (leaseToken === undefined) continue;

    const handler = handlers[job.type];
    if (handler === undefined) continue; // types가 handlers 키에서 왔으므로 이론상 오지 않는다.

    try {
      await handler(job.inputRef, now);
      await queue.complete(job.id, leaseToken, now);
      outcome.completed.push(job.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const attemptsAfterThis = job.attempts + 1;
      if (isRetryableError(error) && attemptsAfterThis < job.maxAttempts) {
        const delayMs = computeBackoffDelayMs(attemptsAfterThis);
        await queue.retry(job.id, leaseToken, now, new Date(now.getTime() + delayMs), message);
        outcome.retried.push(job.id);
      } else {
        await queue.deadLetter(job.id, leaseToken, now, message);
        outcome.deadLettered.push({ id: job.id, type: job.type, inputRef: job.inputRef, lastError: message });
      }
    }
  }

  return outcome;
}

// llm/errors.ts의 LLMExtractionError.retryable을 그대로 존중하고, 그 외(일반 Error 등
// 분류 정보가 없는 실패)는 기본적으로 재시도 가능하다고 본다 — 확정적 영구 실패는
// Handler가 명시적으로 retryable:false를 표시해야 한다(과소 재시도보다 안전한 기본값).
function isRetryableError(error: unknown): boolean {
  if (error !== null && typeof error === "object" && "retryable" in error) {
    return Boolean((error as { retryable: unknown }).retryable);
  }
  return true;
}
