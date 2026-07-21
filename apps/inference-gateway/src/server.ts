import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import type { LLMProvider } from "../../../packages/context-engine/src/index.ts";
import type { GatewayConfig } from "./config.ts";
import { InferenceQueue } from "./queue.ts";
import { GatewayStore, hashSecret } from "./store.ts";
import { RequestValidationError, validateInferenceRequest } from "./validation.ts";

export interface GatewayRuntime {
  listen(): Promise<AddressInfo>;
  close(): Promise<void>;
}

export interface GatewayDependencies {
  provider: LLMProvider;
  store?: GatewayStore;
  now?: () => Date;
}

export function createGatewayRuntime(config: GatewayConfig, dependencies: GatewayDependencies): GatewayRuntime {
  const store = dependencies.store ?? new GatewayStore(config.databasePath);
  const ownsStore = dependencies.store === undefined;
  const now = dependencies.now ?? (() => new Date());
  const auth = new GatewayAuth(store, config.bootstrapTokens, config.activationCodes);
  const queue = new InferenceQueue(store, dependencies.provider, config, now);
  const server = createServer((request, response) => {
    setSecurityHeaders(response);
    void route(request, response, { config, store, auth, queue, now }).catch((error) => {
      handleError(response, error);
    });
  });

  return {
    listen: () => listen(server, config.host, config.port).then((address) => {
      queue.start();
      return address;
    }),
    close: async () => {
      await closeServer(server);
      await queue.close();
      if (ownsStore) store.close();
    },
  };
}

interface RouteDependencies {
  config: GatewayConfig;
  store: GatewayStore;
  auth: GatewayAuth;
  queue: InferenceQueue;
  now: () => Date;
}

async function route(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: RouteDependencies,
): Promise<void> {
  const method = request.method ?? "GET";
  const path = new URL(request.url ?? "/", "http://gateway.local").pathname;

  if (method === "GET" && path === "/health") {
    sendJson(response, 200, { status: "ok" });
    return;
  }

  if (method === "POST" && path === "/v1/auth/activate") {
    const body = await readJson(request, Math.min(dependencies.config.maxBodyBytes, 16_384));
    const activationCode = requiredString(body, "activationCode", 256);
    const deviceName = optionalString(body, "deviceName", 200);
    if (!dependencies.auth.isActivationCodeAllowed(activationCode)) throw httpError(401, "invalid_activation_code", "유효하지 않은 설치 코드입니다");
    const result = dependencies.store.activate(hashSecret(activationCode), deviceName, timestamp(dependencies.now));
    if (result.status === "already_used") throw httpError(409, "activation_code_used", "이미 사용된 설치 코드입니다");
    sendJson(response, 201, { token: result.token, tokenType: "Bearer" });
    return;
  }

  const ownerTokenHash = dependencies.auth.authenticate(request.headers.authorization);
  if (ownerTokenHash === undefined) throw httpError(401, "unauthorized", "유효한 Bearer Token이 필요합니다");

  if (method === "POST" && path === "/v1/inference/jobs") {
    if (dependencies.store.activeJobCount() >= dependencies.config.maxQueueSize) {
      throw httpError(503, "queue_full", "LLM 작업 대기열이 가득 찼습니다", true);
    }
    const body = await readJson(request, dependencies.config.maxBodyBytes);
    const inferenceRequest = validateInferenceRequest(body, dependencies.config);
    const current = dependencies.now();
    if (!dependencies.store.reserveDailyQuota(
      ownerTokenHash,
      current.toISOString().slice(0, 10),
      dependencies.config.maxJobAttemptsPerDay,
    )) {
      throw httpError(429, "daily_quota_exceeded", "오늘의 LLM 작업 한도를 초과했습니다", true);
    }
    const job = dependencies.store.createJob(
      ownerTokenHash,
      inferenceRequest,
      current.toISOString(),
      new Date(current.getTime() + dependencies.config.jobTtlMs).toISOString(),
    );
    dependencies.queue.notifyJobCreated();
    sendJson(response, 202, {
      jobId: job.id,
      status: "queued",
      pollAfterMs: dependencies.config.pollAfterMs,
    });
    return;
  }

  const match = /^\/v1\/inference\/jobs\/([^/]+)$/.exec(path);
  if (match !== null && method === "GET") {
    const job = dependencies.store.findOwnedJob(decodeURIComponent(match[1]!), ownerTokenHash);
    if (job === undefined) throw httpError(404, "job_not_found", "작업을 찾을 수 없습니다");
    sendJson(response, 200, dependencies.store.toResponse(job, dependencies.config.pollAfterMs));
    return;
  }
  if (match !== null && method === "DELETE") {
    const job = dependencies.store.cancelOwnedJob(
      decodeURIComponent(match[1]!),
      ownerTokenHash,
      timestamp(dependencies.now),
    );
    if (job === undefined) throw httpError(404, "job_not_found", "작업을 찾을 수 없습니다");
    sendJson(response, 200, dependencies.store.toResponse(job, dependencies.config.pollAfterMs));
    return;
  }

  throw httpError(404, "not_found", "지원하지 않는 endpoint입니다");
}

class GatewayAuth {
  private readonly store: GatewayStore;
  private readonly bootstrapTokenHashes: Set<string>;
  private readonly activationCodeHashes: Set<string>;

  constructor(store: GatewayStore, bootstrapTokens: string[], activationCodes: string[]) {
    this.store = store;
    this.bootstrapTokenHashes = new Set(bootstrapTokens.map(hashSecret));
    this.activationCodeHashes = new Set(activationCodes.map(hashSecret));
  }

  authenticate(header: string | undefined): string | undefined {
    const match = /^Bearer\s+(.+)$/i.exec(header ?? "");
    if (match === null) return undefined;
    const tokenHash = hashSecret(match[1]!.trim());
    if (containsHash(this.bootstrapTokenHashes, tokenHash)) return tokenHash;
    return this.store.isDeviceTokenActive(tokenHash) ? tokenHash : undefined;
  }

  isActivationCodeAllowed(code: string): boolean {
    return containsHash(this.activationCodeHashes, hashSecret(code));
  }
}

class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;

  constructor(status: number, code: string, message: string, retryable: boolean) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

async function readJson(request: IncomingMessage, maxBytes: number): Promise<Record<string, unknown>> {
  const declared = Number(request.headers["content-length"] ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) throw httpError(413, "body_too_large", "요청 본문이 너무 큽니다");

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw httpError(413, "body_too_large", "요청 본문이 너무 큽니다");
    chunks.push(buffer);
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!isRecord(parsed)) throw new Error("not object");
    return parsed;
  } catch {
    throw httpError(400, "invalid_json", "요청 본문은 유효한 JSON object여야 합니다");
  }
}

function requiredString(body: Record<string, unknown>, field: string, maxLength: number): string {
  const value = body[field];
  if (typeof value !== "string" || value.trim() === "" || value.length > maxLength) {
    throw httpError(400, "invalid_request", `${field}가 올바르지 않습니다`);
  }
  return value.trim();
}

function optionalString(body: Record<string, unknown>, field: string, maxLength: number): string | undefined {
  if (body[field] === undefined) return undefined;
  return requiredString(body, field, maxLength);
}

function handleError(response: ServerResponse, error: unknown): void {
  if (response.headersSent) {
    response.end();
    return;
  }
  if (error instanceof RequestValidationError) {
    sendJson(response, 400, { error: { code: "invalid_request", message: error.message, retryable: false } });
    return;
  }
  if (error instanceof HttpError) {
    sendJson(response, error.status, {
      error: { code: error.code, message: error.message, retryable: error.retryable },
    });
    return;
  }
  sendJson(response, 500, {
    error: { code: "internal_error", message: "Gateway 내부 오류가 발생했습니다", retryable: true },
  });
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  response.end(body);
}

function setSecurityHeaders(response: ServerResponse): void {
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("referrer-policy", "no-referrer");
}

function containsHash(hashes: Set<string>, candidate: string): boolean {
  const candidateBuffer = Buffer.from(candidate, "hex");
  for (const hash of hashes) {
    const hashBuffer = Buffer.from(hash, "hex");
    if (hashBuffer.length === candidateBuffer.length && timingSafeEqual(hashBuffer, candidateBuffer)) return true;
  }
  return false;
}

function listen(server: Server, host: string, port: number): Promise<AddressInfo> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve(server.address() as AddressInfo);
    });
  });
}

function closeServer(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
}

function timestamp(now: () => Date): string {
  return now().toISOString();
}

function httpError(status: number, code: string, message: string, retryable = false): HttpError {
  return new HttpError(status, code, message, retryable);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
