import { OllamaProvider } from "../../../../packages/context-engine/src/index.ts";

const DEFAULT_TEXT_MODEL = "gemma3:12b";
const DEFAULT_VISION_MODEL = "gemma3:4b";

export interface LlmConfig {
  baseUrl: string;
  textModel: string;
  visionModel: string;
}

// .env(DODODO_LLM_BASE_URL 등, .env.example 참고) 파싱만 한다 — Provider 생성과
// doctor의 상태 표시(baseUrl/모델 이름) 둘 다 이 함수 하나로 일관되게 만든다.
export function resolveLlmConfig(env: NodeJS.ProcessEnv = process.env): LlmConfig | undefined {
  const baseUrl = env.DODODO_LLM_BASE_URL?.trim();
  if (baseUrl === undefined || baseUrl === "") return undefined;

  return {
    baseUrl,
    textModel: env.DODODO_TEXT_MODEL?.trim() || DEFAULT_TEXT_MODEL,
    visionModel: env.DODODO_VISION_MODEL?.trim() || DEFAULT_VISION_MODEL,
  };
}

// 미설정이면 undefined를 반환해 호출부가 기존 규칙·템플릿 폴백을 그대로 쓰게 한다 —
// .env 없이도 회귀 없이 지금처럼 동작해야 한다(docs/handoff-cli-llm-wiring.md).
// env를 인자로 받아 실제 process.env를 건드리지 않고 테스트할 수 있게 한다.
export function createLlmProvider(env: NodeJS.ProcessEnv = process.env): OllamaProvider | undefined {
  const config = resolveLlmConfig(env);
  return config === undefined ? undefined : new OllamaProvider(config);
}
