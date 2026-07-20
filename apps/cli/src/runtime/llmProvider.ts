import { OllamaProvider } from "../../../../packages/context-engine/src/index.ts";

const DEFAULT_TEXT_MODEL = "gemma3:12b";
const DEFAULT_VISION_MODEL = "gemma3:4b";

// .env(DODODO_LLM_BASE_URL 등, .env.example 참고)로 로컬/원격 Ollama 서버를 연결한다.
// 미설정이면 undefined를 반환해 호출부가 기존 규칙·템플릿 폴백을 그대로 쓰게 한다 —
// .env 없이도 회귀 없이 지금처럼 동작해야 한다(docs/handoff-cli-llm-wiring.md).
// env를 인자로 받아 실제 process.env를 건드리지 않고 테스트할 수 있게 한다.
export function createLlmProvider(env: NodeJS.ProcessEnv = process.env): OllamaProvider | undefined {
  const baseUrl = env.DODODO_LLM_BASE_URL?.trim();
  if (baseUrl === undefined || baseUrl === "") return undefined;

  return new OllamaProvider({
    baseUrl,
    textModel: env.DODODO_TEXT_MODEL?.trim() || DEFAULT_TEXT_MODEL,
    visionModel: env.DODODO_VISION_MODEL?.trim() || DEFAULT_VISION_MODEL,
  });
}
