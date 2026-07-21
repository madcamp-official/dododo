export interface GatewayConfig {
  host: string;
  port: number;
  databasePath: string;
  ollamaBaseUrl: string;
  textModel: string;
  visionModel: string;
  ollamaTimeoutMs: number;
  maxConcurrentJobs: number;
  maxQueueSize: number;
  maxJobAttemptsPerDay: number;
  jobTtlMs: number;
  pollAfterMs: number;
  maxTextBytes: number;
  maxImageBytes: number;
  maxImages: number;
  maxSchemaBytes: number;
  maxBodyBytes: number;
  bootstrapTokens: string[];
  activationCodes: string[];
}

export function loadGatewayConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const maxImageBytes = positiveInteger(env.GATEWAY_MAX_IMAGE_BYTES, 5_000_000, "GATEWAY_MAX_IMAGE_BYTES");
  const maxImages = positiveInteger(env.GATEWAY_MAX_IMAGES, 1, "GATEWAY_MAX_IMAGES");
  const maxTextBytes = positiveInteger(env.GATEWAY_MAX_TEXT_BYTES, 50_000, "GATEWAY_MAX_TEXT_BYTES");
  const maxSchemaBytes = positiveInteger(env.GATEWAY_MAX_SCHEMA_BYTES, 50_000, "GATEWAY_MAX_SCHEMA_BYTES");
  const calculatedBodyLimit = maxTextBytes + maxSchemaBytes + Math.ceil(maxImageBytes * maxImages * 4 / 3) + 64_000;
  const bootstrapTokens = csv(env.GATEWAY_BEARER_TOKENS);
  const activationCodes = csv(env.GATEWAY_ACTIVATION_CODES);

  if (bootstrapTokens.length === 0 && activationCodes.length === 0) {
    throw new Error("GATEWAY_BEARER_TOKENS 또는 GATEWAY_ACTIVATION_CODES 중 하나는 설정해야 합니다");
  }

  return {
    host: env.GATEWAY_HOST?.trim() || "127.0.0.1",
    port: port(env.GATEWAY_PORT, 18_080),
    databasePath: env.GATEWAY_DB_PATH?.trim() || "/var/lib/dododo/gateway.db",
    ollamaBaseUrl: (env.OLLAMA_BASE_URL?.trim() || "http://127.0.0.1:11434").replace(/\/+$/, ""),
    textModel: env.OLLAMA_TEXT_MODEL?.trim() || "gemma3:12b",
    visionModel: env.OLLAMA_VISION_MODEL?.trim() || "gemma3:4b",
    ollamaTimeoutMs: positiveInteger(env.OLLAMA_TIMEOUT_MS, 15 * 60 * 1000, "OLLAMA_TIMEOUT_MS"),
    maxConcurrentJobs: positiveInteger(env.GATEWAY_MAX_CONCURRENT_JOBS, 1, "GATEWAY_MAX_CONCURRENT_JOBS"),
    maxQueueSize: positiveInteger(env.GATEWAY_MAX_QUEUE_SIZE, 32, "GATEWAY_MAX_QUEUE_SIZE"),
    maxJobAttemptsPerDay: positiveInteger(env.GATEWAY_DAILY_JOB_LIMIT, 50, "GATEWAY_DAILY_JOB_LIMIT"),
    jobTtlMs: positiveInteger(env.GATEWAY_JOB_TTL_MINUTES, 30, "GATEWAY_JOB_TTL_MINUTES") * 60_000,
    pollAfterMs: positiveInteger(env.GATEWAY_POLL_AFTER_MS, 2_000, "GATEWAY_POLL_AFTER_MS"),
    maxTextBytes,
    maxImageBytes,
    maxImages,
    maxSchemaBytes,
    maxBodyBytes: positiveInteger(env.GATEWAY_MAX_BODY_BYTES, calculatedBodyLimit, "GATEWAY_MAX_BODY_BYTES"),
    bootstrapTokens,
    activationCodes,
  };
}

function csv(value: string | undefined): string[] {
  return [...new Set((value ?? "").split(",").map((item) => item.trim()).filter(Boolean))];
}

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name}는 0보다 큰 정수여야 합니다`);
  return parsed;
}

function port(value: string | undefined, fallback: number): number {
  const parsed = positiveInteger(value, fallback, "GATEWAY_PORT");
  if (parsed > 65_535) throw new Error("GATEWAY_PORT는 65535 이하여야 합니다");
  return parsed;
}
