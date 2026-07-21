import { LLMExtractionError } from "./errors.ts";
import type { LLMErrorCategory } from "./errors.ts";
import { validateAgainstSchema } from "./jsonSchema.ts";
import type { LLMJSONRequest, LLMProvider } from "./provider.ts";
import type {
  CreateInferenceJobResponse,
  GatewayErrorResponse,
  InferenceJobResponse,
  RemoteInferenceRequest,
} from "./remoteProtocol.ts";

export interface RemoteJobLLMProviderConfig {
  baseUrl: string;
  token: string;
  defaultTimeoutMs?: number;
  requestTimeoutMs?: number;
  fetchImplementation?: typeof fetch;
  sleepImplementation?: (milliseconds: number) => Promise<void>;
}

const DEFAULT_TOTAL_TIMEOUT_MS = 20 * 60 * 1000;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_POLL_AFTER_MS = 2_000;
const MIN_POLL_AFTER_MS = 250;
const MAX_POLL_AFTER_MS = 5_000;
const MAX_TIMEOUT_MS = 2_147_483_647;

export class RemoteJobLLMProvider implements LLMProvider {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly defaultTimeoutMs: number;
  private readonly requestTimeoutMs: number;
  private readonly fetchImplementation: typeof fetch;
  private readonly sleepImplementation: (milliseconds: number) => Promise<void>;

  constructor(config: RemoteJobLLMProviderConfig) {
    const baseUrl = config.baseUrl.trim().replace(/\/+$/, "");
    const token = config.token.trim();
    if (baseUrl === "") throw clientError("Remote Gateway baseUrl이 비어 있습니다");
    if (token === "") throw clientError("Remote Gateway token이 비어 있습니다");

    this.defaultTimeoutMs = positiveTimeout(
      config.defaultTimeoutMs ?? DEFAULT_TOTAL_TIMEOUT_MS,
      "defaultTimeoutMs",
    );
    this.requestTimeoutMs = positiveTimeout(
      config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
      "requestTimeoutMs",
    );
    this.baseUrl = baseUrl;
    this.token = token;
    this.fetchImplementation = config.fetchImplementation ?? fetch;
    this.sleepImplementation = config.sleepImplementation ?? sleep;
  }

  async completeJSON<T>(request: LLMJSONRequest<T>): Promise<T> {
    const totalTimeoutMs = positiveTimeout(
      request.timeoutMs ?? this.defaultTimeoutMs,
      request.timeoutMs === undefined ? "defaultTimeoutMs" : "timeoutMs",
    );
    const deadline = Date.now() + totalTimeoutMs;
    const job = await this.createJob(toRemoteRequest(request), deadline);

    try {
      while (true) {
        let status: InferenceJobResponse;
        try {
          status = await this.getJob(job.jobId, deadline);
        } catch (error) {
          // Job 생성 이후 상태 조회는 부작용 없는 GET이다. Cloudflare/Tunnel의 일시적인
          // 502·504, 요청 timeout 등에 Job을 새로 만들지 말고 같은 ID를 다시 조회한다.
          if (!(error instanceof LLMExtractionError) || !error.retryable) throw error;
          const delay = clampPollDelay(job.pollAfterMs);
          if (Date.now() + delay >= deadline) {
            await this.cancelQuietly(job.jobId);
            throw timeoutError(totalTimeoutMs);
          }
          await this.sleepImplementation(delay);
          continue;
        }
        if (status.status === "succeeded") return validateResult(status.result, request);
        if (status.status === "failed") throw jobFailure(status);
        if (status.status === "cancelled") {
          throw new LLMExtractionError("원격 LLM 작업이 취소되었습니다", { category: "client_error" });
        }

        const delay = clampPollDelay(status.pollAfterMs ?? job.pollAfterMs);
        if (Date.now() + delay >= deadline) {
          await this.cancelQuietly(job.jobId);
          throw timeoutError(totalTimeoutMs);
        }
        await this.sleepImplementation(delay);
      }
    } catch (error) {
      if (error instanceof LLMExtractionError) throw error;
      throw new LLMExtractionError("원격 LLM 작업 처리 중 알 수 없는 오류가 발생했습니다", {
        category: "unknown",
        cause: error,
      });
    }
  }

  private async createJob(
    request: RemoteInferenceRequest,
    deadline: number,
  ): Promise<CreateInferenceJobResponse> {
    const response = await this.request("/v1/inference/jobs", {
      method: "POST",
      body: JSON.stringify(request),
    }, deadline);
    if (response.status !== 202) throw await responseError(response, "원격 LLM 작업 생성에 실패했습니다");

    const payload: unknown = await parseJson(response);
    if (!isCreateJobResponse(payload)) throw invalidGatewayResponse("작업 생성 응답 형식이 잘못되었습니다", payload);
    return payload;
  }

  private async getJob(jobId: string, deadline: number): Promise<InferenceJobResponse> {
    const response = await this.request(`/v1/inference/jobs/${encodeURIComponent(jobId)}`, {
      method: "GET",
    }, deadline);
    if (!response.ok) throw await responseError(response, "원격 LLM 작업 상태 조회에 실패했습니다");

    const payload: unknown = await parseJson(response);
    if (!isJobResponse(payload)) throw invalidGatewayResponse("작업 상태 응답 형식이 잘못되었습니다", payload);
    return payload;
  }

  private async cancelQuietly(jobId: string): Promise<void> {
    try {
      await this.request(`/v1/inference/jobs/${encodeURIComponent(jobId)}`, { method: "DELETE" }, Date.now() + 5_000);
    } catch {
      // 취소는 timeout 정리를 위한 best-effort다. 원래 timeout 오류를 가리지 않는다.
    }
  }

  private async request(path: string, init: RequestInit, deadline: number): Promise<Response> {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw timeoutError(this.defaultTimeoutMs);
    const limit = Math.min(this.requestTimeoutMs, remaining);

    try {
      return await this.fetchImplementation(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${this.token}`,
          "content-type": "application/json",
          ...init.headers,
        },
        signal: AbortSignal.timeout(limit),
      });
    } catch (error) {
      if (isTimeoutError(error)) {
        throw new LLMExtractionError(`Remote Gateway 요청이 시간 초과됐습니다 (${limit}ms)`, {
          category: "timeout",
          cause: error,
        });
      }
      throw new LLMExtractionError("Remote Gateway에 연결할 수 없습니다", {
        category: "connection",
        cause: error,
      });
    }
  }
}

function toRemoteRequest<T>(request: LLMJSONRequest<T>): RemoteInferenceRequest {
  return {
    modelKind: request.modelKind,
    systemPrompt: request.systemPrompt,
    userPrompt: request.userPrompt,
    schema: request.schema,
    ...(request.images === undefined ? {} : { images: request.images }),
    ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs }),
    ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
  };
}

function validateResult<T>(value: unknown, request: LLMJSONRequest<T>): T {
  const structural = validateAgainstSchema(value, request.schema);
  if (!structural.valid) {
    throw new LLMExtractionError(
      `원격 LLM 응답이 Schema를 통과하지 못했습니다: ${structural.errors.join("; ")}`,
      { category: "invalid_output", rawResponse: value },
    );
  }
  if (!request.validate(value)) {
    throw new LLMExtractionError("원격 LLM 응답이 추가 검증을 통과하지 못했습니다", {
      category: "invalid_output",
      rawResponse: value,
    });
  }
  return value;
}

function jobFailure(job: InferenceJobResponse): LLMExtractionError {
  const error = job.error;
  return new LLMExtractionError(error?.message ?? "원격 LLM 작업이 실패했습니다", {
    category: error?.category ?? "server_error",
  });
}

async function responseError(response: Response, fallback: string): Promise<LLMExtractionError> {
  const category = categoryForStatus(response.status);
  let message = `${fallback} (HTTP ${response.status})`;
  try {
    const payload: unknown = await response.json();
    if (isGatewayErrorResponse(payload)) message = payload.error.message;
  } catch {
    // Gateway가 JSON을 주지 않아도 상태코드 기반 오류는 유지한다.
  }
  return new LLMExtractionError(message, { category });
}

function categoryForStatus(status: number): LLMErrorCategory {
  if (status === 408 || status === 504) return "timeout";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server_error";
  return "client_error";
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    throw invalidGatewayResponse("Gateway 응답이 JSON이 아닙니다", error);
  }
}

function isCreateJobResponse(value: unknown): value is CreateInferenceJobResponse {
  return isRecord(value)
    && typeof value.jobId === "string"
    && value.status === "queued"
    && typeof value.pollAfterMs === "number";
}

function isJobResponse(value: unknown): value is InferenceJobResponse {
  if (!isRecord(value)) return false;
  return typeof value.jobId === "string"
    && isJobStatus(value.status)
    && typeof value.createdAt === "string"
    && typeof value.updatedAt === "string"
    && typeof value.expiresAt === "string";
}

function isJobStatus(value: unknown): boolean {
  return value === "queued" || value === "running" || value === "succeeded"
    || value === "failed" || value === "cancelled";
}

function isGatewayErrorResponse(value: unknown): value is GatewayErrorResponse {
  return isRecord(value) && isRecord(value.error) && typeof value.error.message === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidGatewayResponse(message: string, rawResponse: unknown): LLMExtractionError {
  return new LLMExtractionError(message, { category: "invalid_output", rawResponse });
}

function timeoutError(timeoutMs: number): LLMExtractionError {
  return new LLMExtractionError(`원격 LLM 작업 전체 시간이 초과됐습니다 (${timeoutMs}ms)`, {
    category: "timeout",
  });
}

function clientError(message: string): LLMExtractionError {
  return new LLMExtractionError(message, { category: "client_error" });
}

function positiveTimeout(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_TIMEOUT_MS) {
    throw clientError(`${name}는 1 이상 ${MAX_TIMEOUT_MS} 이하의 정수여야 합니다`);
  }
  return value;
}

function clampPollDelay(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_POLL_AFTER_MS;
  return Math.max(MIN_POLL_AFTER_MS, Math.min(MAX_POLL_AFTER_MS, Math.round(value)));
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
