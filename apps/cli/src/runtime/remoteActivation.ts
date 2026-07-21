import { chmod, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

import {
  RemoteJobLLMProvider,
  type ActivateDeviceResponse,
  type GatewayErrorResponse,
} from "../../../../packages/context-engine/src/index.ts";

export const DEFAULT_REMOTE_GATEWAY_URL = "https://llm.madcamp-kaist.org";
export const DEFAULT_REMOTE_TIMEOUT_MS = 20 * 60 * 1000;

export interface ActivateRemoteDeviceOptions {
  baseUrl?: string;
  deviceName: string;
  activationCode: string;
  fetchImplementation?: typeof fetch;
  requestTimeoutMs?: number;
}

export interface SaveRemoteLlmConfigOptions {
  envPath: string;
  baseUrl: string;
  token: string;
  timeoutMs?: number;
}

export interface VerifyRemoteInferenceOptions {
  baseUrl: string;
  token: string;
  timeoutMs?: number;
  fetchImplementation?: typeof fetch;
  sleepImplementation?: (milliseconds: number) => Promise<void>;
}

export async function activateRemoteDevice(
  options: ActivateRemoteDeviceOptions,
): Promise<ActivateDeviceResponse> {
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_REMOTE_GATEWAY_URL);
  const activationCode = options.activationCode.trim();
  if (activationCode === "") throw new Error("설치 코드가 비어 있습니다");

  const fetchImplementation = options.fetchImplementation ?? fetch;
  const timeoutMs = options.requestTimeoutMs ?? 15_000;
  let response: Response;
  try {
    response = await fetchImplementation(`${baseUrl}/v1/auth/activate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ activationCode, deviceName: options.deviceName }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`원격 LLM 활성화 서버에 연결할 수 없습니다: ${reason}`, { cause: error });
  }

  if (response.status !== 201) {
    throw new Error(await activationErrorMessage(response));
  }

  const payload: unknown = await parseJson(response);
  if (!isActivateDeviceResponse(payload)) {
    throw new Error("원격 LLM 활성화 응답 형식이 올바르지 않습니다");
  }
  return payload;
}

export async function saveRemoteLlmConfig(options: SaveRemoteLlmConfigOptions): Promise<void> {
  const values = new Map<string, string>([
    ["DODODO_LLM_PROVIDER", "remote-job"],
    ["DODODO_LLM_BASE_URL", normalizeBaseUrl(options.baseUrl)],
    ["DODODO_LLM_TOKEN", requiredSingleLine(options.token, "기기 토큰")],
    ["DODODO_LLM_TIMEOUT_MS", String(options.timeoutMs ?? DEFAULT_REMOTE_TIMEOUT_MS)],
  ]);

  let existing = "";
  try {
    existing = await readFile(options.envPath, "utf8");
  } catch (error) {
    if (!isMissingFile(error)) throw error;
  }

  const content = upsertEnvValues(existing, values);
  const tempPath = `${options.envPath}.tmp-${randomUUID()}`;
  try {
    await writeFile(tempPath, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await rename(tempPath, options.envPath);
    await chmod(options.envPath, 0o600);
  } finally {
    await rm(tempPath, { force: true });
  }
}

export async function verifyRemoteInference(options: VerifyRemoteInferenceOptions): Promise<void> {
  const provider = new RemoteJobLLMProvider({
    baseUrl: options.baseUrl,
    token: options.token,
    defaultTimeoutMs: options.timeoutMs ?? DEFAULT_REMOTE_TIMEOUT_MS,
    ...(options.fetchImplementation === undefined ? {} : { fetchImplementation: options.fetchImplementation }),
    ...(options.sleepImplementation === undefined ? {} : { sleepImplementation: options.sleepImplementation }),
  });
  await provider.completeJSON({
    modelKind: "text",
    systemPrompt: "Return only JSON matching the provided schema.",
    userPrompt: "DoDoDo authenticated connection test. Return status ok.",
    schema: {
      type: "object",
      required: ["status"],
      properties: { status: { type: "string", enum: ["ok"] } },
    },
    temperature: 0,
    validate: (value): value is { status: "ok" } => (
      typeof value === "object" && value !== null && (value as { status?: unknown }).status === "ok"
    ),
  });
}

function upsertEnvValues(existing: string, values: Map<string, string>): string {
  const found = new Set<string>();
  const output: string[] = [];
  for (const line of existing.split(/\r?\n/)) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(line);
    const key = match?.[1];
    if (key === undefined || !values.has(key)) {
      output.push(line);
      continue;
    }
    if (found.has(key)) continue;
    output.push(`${key}=${serializeEnvValue(values.get(key)!)}`);
    found.add(key);
  }

  if (output.length > 0 && output.at(-1) !== "") output.push("");
  for (const [key, value] of values) {
    if (!found.has(key)) output.push(`${key}=${serializeEnvValue(value)}`);
  }
  return `${output.join("\n").replace(/\n+$/, "")}\n`;
}

function serializeEnvValue(value: string): string {
  const checked = requiredSingleLine(value, "환경변수");
  return /^[A-Za-z0-9_./:@+-]+$/.test(checked) ? checked : JSON.stringify(checked);
}

function normalizeBaseUrl(value: string): string {
  const normalized = requiredSingleLine(value, "Gateway URL").replace(/\/+$/, "");
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error("Gateway URL이 올바르지 않습니다");
  }
  if (url.protocol !== "https:" && url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    throw new Error("원격 Gateway는 HTTPS URL이어야 합니다");
  }
  return normalized;
}

function requiredSingleLine(value: string, field: string): string {
  const trimmed = value.trim();
  if (trimmed === "" || /[\r\n]/.test(trimmed)) throw new Error(`${field} 값이 올바르지 않습니다`);
  return trimmed;
}

async function activationErrorMessage(response: Response): Promise<string> {
  try {
    const payload: unknown = await response.json();
    if (isGatewayErrorResponse(payload)) {
      return `원격 LLM 활성화에 실패했습니다: ${payload.error.message} (HTTP ${response.status})`;
    }
  } catch {
    // Cloudflare의 plain-text 502처럼 JSON이 아닌 오류는 상태코드만 안전하게 표시한다.
  }
  return `원격 LLM 활성화에 실패했습니다 (HTTP ${response.status})`;
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    throw new Error("원격 LLM 활성화 응답이 JSON이 아닙니다", { cause: error });
  }
}

function isActivateDeviceResponse(value: unknown): value is ActivateDeviceResponse {
  return typeof value === "object" && value !== null
    && typeof (value as { token?: unknown }).token === "string"
    && (value as { token: string }).token.trim() !== ""
    && (value as { tokenType?: unknown }).tokenType === "Bearer";
}

function isGatewayErrorResponse(value: unknown): value is GatewayErrorResponse {
  if (typeof value !== "object" || value === null) return false;
  const error = (value as { error?: unknown }).error;
  return typeof error === "object" && error !== null
    && typeof (error as { message?: unknown }).message === "string";
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as NodeJS.ErrnoException).code === "ENOENT";
}
