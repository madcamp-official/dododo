import {
  LLMExtractionError,
  type InferenceJobError,
  type LLMProvider,
  type RemoteInferenceRequest,
} from "../../../packages/context-engine/src/index.ts";
import type { GatewayConfig } from "./config.ts";
import { GatewayStore, type StoredInferenceJob } from "./store.ts";

export class InferenceQueue {
  private readonly store: GatewayStore;
  private readonly provider: LLMProvider;
  private readonly config: GatewayConfig;
  private readonly now: () => Date;
  private activeWorkers = 0;
  private closed = false;
  private readonly cleanupTimer: NodeJS.Timeout;

  constructor(
    store: GatewayStore,
    provider: LLMProvider,
    config: GatewayConfig,
    now: () => Date = () => new Date(),
  ) {
    this.store = store;
    this.provider = provider;
    this.config = config;
    this.now = now;
    this.store.recoverInterruptedJobs(this.timestamp());
    this.cleanupTimer = setInterval(() => this.store.deleteExpired(this.timestamp()), 60_000);
    this.cleanupTimer.unref();
  }

  start(): void {
    this.kick();
  }

  notifyJobCreated(): void {
    this.kick();
  }

  async close(): Promise<void> {
    this.closed = true;
    clearInterval(this.cleanupTimer);
    while (this.activeWorkers > 0) await new Promise((resolve) => setTimeout(resolve, 25));
  }

  private kick(): void {
    if (this.closed) return;
    while (this.activeWorkers < this.config.maxConcurrentJobs) {
      const job = this.store.claimNextQueuedJob(this.timestamp());
      if (job === undefined) return;
      this.activeWorkers += 1;
      void this.execute(job).finally(() => {
        this.activeWorkers -= 1;
        this.kick();
      });
    }
  }

  private async execute(job: StoredInferenceJob): Promise<void> {
    if (job.request === undefined) {
      this.store.failJob(job.id, failure("client_error", "저장된 Job 요청이 없습니다", false), this.timestamp());
      return;
    }

    try {
      const result = await this.provider.completeJSON({
        ...job.request,
        timeoutMs: job.request.timeoutMs ?? this.config.ollamaTimeoutMs,
        validate: (_value): _value is unknown => true,
      });
      this.store.succeedJob(job.id, result, this.timestamp());
    } catch (error) {
      const mapped = toJobError(error);
      this.store.failJob(job.id, mapped, this.timestamp());
    }
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}

function toJobError(error: unknown): InferenceJobError {
  if (error instanceof LLMExtractionError) {
    return failure(error.category, safeMessage(error.message), error.retryable);
  }
  return failure("unknown", "LLM 작업 중 알 수 없는 서버 오류가 발생했습니다", false);
}

function failure(
  category: InferenceJobError["category"],
  message: string,
  retryable: boolean,
): InferenceJobError {
  return { category, message, retryable };
}

function safeMessage(message: string): string {
  return message.slice(0, 500);
}
