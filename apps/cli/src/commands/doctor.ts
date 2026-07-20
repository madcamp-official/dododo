import type { CliContainer } from "../runtime/container.ts";
import { renderSourceStatus } from "../runtime/sourceStatus.ts";
import { commandCatalog } from "./catalog.ts";

// 헬스체크가 멈춰있는 Ollama 서버에 오래 안 걸리게 짧게 끊는다.
const LLM_STATUS_TIMEOUT_MS = 3000;

export async function renderDoctor(
  container: CliContainer,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const ready = commandCatalog.filter((command) => command.status === "ready").length;
  const skeleton = commandCatalog.length - ready;

  return [
    "dododo doctor",
    `Node: ${process.version}`,
    `Runtime: ${process.platform}/${process.arch}`,
    `Commands: ${ready} ready, ${skeleton} skeleton`,
    "Storage: in-memory scaffold (SQLite pending)",
    await renderLlmStatus(container, fetchImpl),
    "",
    renderSourceStatus(container),
  ].join("\n");
}

async function renderLlmStatus(container: CliContainer, fetchImpl: typeof fetch): Promise<string> {
  if (container.llmConfig === undefined) {
    return "LLM: 미설정(.env의 DODODO_LLM_BASE_URL 없음) — 임시 추출기·템플릿 사용 중";
  }

  const { baseUrl, textModel, visionModel } = container.llmConfig;
  const base = `LLM: ${baseUrl} · text=${textModel} vision=${visionModel}`;

  try {
    const response = await fetchImpl(`${baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(LLM_STATUS_TIMEOUT_MS),
    });
    return response.ok ? `${base} · 연결 OK` : `${base} · 연결 실패(HTTP ${response.status})`;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return `${base} · 연결 실패(${reason})`;
  }
}
