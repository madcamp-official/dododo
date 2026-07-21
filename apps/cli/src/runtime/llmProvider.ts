import {
  OllamaProvider,
  RemoteJobLLMProvider,
  type LLMProvider,
} from "../../../../packages/context-engine/src/index.ts";

const DEFAULT_TEXT_MODEL = "gemma3:12b";
const DEFAULT_VISION_MODEL = "gemma3:4b";

export interface LlmConfig {
  provider: "ollama" | "remote-job";
  baseUrl: string;
  textModel: string;
  visionModel: string;
  token?: string;
  timeoutMs: number;
  configurationError?: string;
}

const DEFAULT_REMOTE_TIMEOUT_MS = 20 * 60 * 1000;

// .env(DODODO_LLM_BASE_URL 등, .env.example 참고) 파싱만 한다 — Provider 생성과
// doctor의 상태 표시(baseUrl/모델 이름) 둘 다 이 함수 하나로 일관되게 만든다.
export function resolveLlmConfig(env: NodeJS.ProcessEnv = process.env): LlmConfig | undefined {
  const baseUrl = env.DODODO_LLM_BASE_URL?.trim();
  if (baseUrl === undefined || baseUrl === "") return undefined;

  const providerValue = env.DODODO_LLM_PROVIDER?.trim() || "ollama";
  if (providerValue !== "ollama" && providerValue !== "remote-job") {
    return {
      provider: "ollama",
      baseUrl,
      textModel: env.DODODO_TEXT_MODEL?.trim() || DEFAULT_TEXT_MODEL,
      visionModel: env.DODODO_VISION_MODEL?.trim() || DEFAULT_VISION_MODEL,
      timeoutMs: DEFAULT_REMOTE_TIMEOUT_MS,
      configurationError: "DODODO_LLM_PROVIDER는 ollama 또는 remote-job이어야 합니다",
    };
  }

  const timeout = parseTimeout(env.DODODO_LLM_TIMEOUT_MS);
  const token = env.DODODO_LLM_TOKEN?.trim();
  const configurationError = timeout.error
    ?? (providerValue === "remote-job" && !token ? "remote-job Provider에는 DODODO_LLM_TOKEN이 필요합니다" : undefined);

  return {
    provider: providerValue,
    baseUrl,
    textModel: env.DODODO_TEXT_MODEL?.trim() || DEFAULT_TEXT_MODEL,
    visionModel: env.DODODO_VISION_MODEL?.trim() || DEFAULT_VISION_MODEL,
    ...(token ? { token } : {}),
    timeoutMs: timeout.value,
    ...(configurationError === undefined ? {} : { configurationError }),
  };
}

// 미설정이면 undefined를 반환해 호출부가 기존 규칙·템플릿 폴백을 그대로 쓰게 한다 —
// .env 없이도 회귀 없이 지금처럼 동작해야 한다(docs/handoff-cli-llm-wiring.md).
// env를 인자로 받아 실제 process.env를 건드리지 않고 테스트할 수 있게 한다.
export function createLlmProvider(env: NodeJS.ProcessEnv = process.env): LLMProvider | undefined {
  const config = resolveLlmConfig(env);
  if (config === undefined || config.configurationError !== undefined) return undefined;
  if (config.provider === "remote-job") {
    return new RemoteJobLLMProvider({
      baseUrl: config.baseUrl,
      token: config.token!,
      defaultTimeoutMs: config.timeoutMs,
    });
  }
  return new OllamaProvider(config);
}

function parseTimeout(value: string | undefined): { value: number; error?: string } {
  if (value === undefined || value.trim() === "") return { value: DEFAULT_REMOTE_TIMEOUT_MS };
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return {
      value: DEFAULT_REMOTE_TIMEOUT_MS,
      error: "DODODO_LLM_TIMEOUT_MS는 0보다 큰 정수여야 합니다",
    };
  }
  return { value: parsed };
}
