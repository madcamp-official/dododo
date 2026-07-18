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
  // 구조적 Schema 검증을 통과한 뒤 추가로 의미적 조건(예: 배열 필드 존재)을
  // 확인하고 타입을 좁힌다. 실패하면 completeJSON이 LLMExtractionError를 던진다.
  validate: (value: unknown) => value is T;
}

export interface LLMProvider {
  completeJSON<T>(request: LLMJSONRequest<T>): Promise<T>;
}
