import type { JSONSchemaNode } from "./jsonSchema.ts";

// resolution/·recommendation/·classification/은 이 인터페이스만 알고
// 구체 Provider(Ollama, OpenAI 호환 등)를 직접 import하지 않는다.
// Provider를 교체해도 이 파일 밖은 영향받지 않아야 한다.
export type LLMModelKind = "text" | "vision";

export interface LLMJSONRequest<T> {
  modelKind: LLMModelKind;
  systemPrompt: string;
  userPrompt: string;
  schema: JSONSchemaNode;
  images?: string[];
  // 호출 시간 상한(ms). 초과하면 category "timeout"인 LLMExtractionError로 실패한다.
  // 지정하지 않으면 Provider 기본값을 쓴다.
  timeoutMs?: number;
  // 구조화 추출은 일관성이 중요하므로 낮은 값(예: 0)을 권장한다(docs/llm-architecture.md §7).
  // 지정하지 않으면 모델 기본값을 쓴다.
  temperature?: number;
  // 구조적 Schema 검증을 통과한 뒤 추가로 의미적 조건(예: 배열 필드 존재)을
  // 확인하고 타입을 좁힌다. 실패하면 completeJSON이 LLMExtractionError를 던진다.
  validate: (value: unknown) => value is T;
}

export interface LLMProvider {
  completeJSON<T>(request: LLMJSONRequest<T>): Promise<T>;
}
