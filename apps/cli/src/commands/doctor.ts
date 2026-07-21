import type { CliContainer } from "../runtime/container.ts";
import { verifyRemoteInference } from "../runtime/remoteActivation.ts";
import { renderSourceStatus } from "../runtime/sourceStatus.ts";
import { commandCatalog } from "./catalog.ts";

// 헬스체크가 멈춰있는 Ollama 서버에 오래 안 걸리게 짧게 끊는다.
const LLM_STATUS_TIMEOUT_MS = 3000;

export async function renderDoctor(
  container: CliContainer,
  fetchImpl: typeof fetch = fetch,
  options: { verifyRemoteInference?: boolean } = {},
): Promise<string> {
  const ready = commandCatalog.filter((command) => command.status === "ready").length;
  const skeleton = commandCatalog.length - ready;

  const lines = [
    "dododo doctor",
    `Node: ${process.version}`,
    `Runtime: ${process.platform}/${process.arch}`,
    `Commands: ${ready} ready, ${skeleton} skeleton`,
    renderStorageStatus(container),
    renderSourcesStatus(container),
    await renderLlmStatus(container, fetchImpl),
  ];
  if (options.verifyRemoteInference) lines.push(await renderAuthenticatedLlmTest(container, fetchImpl));
  lines.push("", renderSourceStatus(container));
  return lines.join("\n");
}

async function renderAuthenticatedLlmTest(
  container: CliContainer,
  fetchImpl: typeof fetch,
): Promise<string> {
  const config = container.llmConfig;
  if (config?.provider !== "remote-job") {
    return "LLM 인증 추론: remote-job Provider에서만 사용할 수 있습니다";
  }
  if (!config.token) return "LLM 인증 추론: DODODO_LLM_TOKEN이 필요합니다";

  try {
    await verifyRemoteInference({
      baseUrl: config.baseUrl,
      token: config.token,
      timeoutMs: config.timeoutMs,
      fetchImplementation: fetchImpl,
    });
    return "LLM 인증 추론: OK";
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return `LLM 인증 추론: 실패(${reason})`;
  }
}

async function renderLlmStatus(container: CliContainer, fetchImpl: typeof fetch): Promise<string> {
  if (container.llmConfig === undefined) {
    return "LLM: 미설정(.env의 DODODO_LLM_BASE_URL 없음) — 임시 추출기·템플릿 사용 중";
  }

  const { baseUrl, textModel, visionModel } = container.llmConfig;
  if (container.llmConfig.configurationError !== undefined) {
    return `LLM: 설정 오류(${container.llmConfig.configurationError})`;
  }
  const remote = container.llmConfig.provider === "remote-job";
  const base = remote
    ? `LLM: remote-job ${baseUrl}`
    : `LLM: ${baseUrl} · text=${textModel} vision=${visionModel}`;

  try {
    const response = await fetchImpl(`${baseUrl}${remote ? "/health" : "/api/tags"}`, {
      signal: AbortSignal.timeout(LLM_STATUS_TIMEOUT_MS),
    });
    return response.ok ? `${base} · 연결 OK` : `${base} · 연결 실패(HTTP ${response.status})`;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return `${base} · 연결 실패(${reason})`;
  }
}

function renderStorageStatus(container: CliContainer): string {
  return container.dbPath === undefined
    ? "Storage: in-memory (DODODO_DB_PATH=:memory:)"
    : `Storage: SQLite (${container.dbPath})`;
}

function renderSourcesStatus(container: CliContainer): string {
  if (container.sourcesConfigError !== undefined) {
    return `Sources: 설정 오류 — 수집 중단(Fixture로 대체 안 함) (${container.sourcesConfigError})`;
  }
  if (container.sourcesConfigPath === undefined) {
    return "Sources: Fixture 데모 (DODODO_SOURCE_CONFIG 없음)";
  }
  const origin = container.sourcesConfigPathIsExplicit
    ? "DODODO_SOURCE_CONFIG"
    : "cwd 기본값, 환경변수 미설정";
  return `Sources: 실제 설정 사용 중 (${container.sourcesConfigPath}, 출처: ${origin})`;
}
