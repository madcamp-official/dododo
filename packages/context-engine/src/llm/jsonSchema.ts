// 새 의존성 없이 LLM 구조화 출력을 검증하기 위한 최소 JSON Schema 하위 집합.
// 지원 범위: type, required, enum, properties, items, minimum, maximum, format:"date-time".
// 필요한 조건이 늘어나면 이 파일을 확장하고, ajv 같은 라이브러리 도입은 별도로 제안한다.
export type JSONSchemaType = "object" | "array" | "string" | "number" | "boolean";

export interface JSONSchemaNode {
  type: JSONSchemaType;
  properties?: Record<string, JSONSchemaNode>;
  required?: string[];
  items?: JSONSchemaNode;
  enum?: readonly string[];
  minimum?: number;
  maximum?: number;
  format?: "date-time";
}

export interface SchemaValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateAgainstSchema(value: unknown, schema: JSONSchemaNode): SchemaValidationResult {
  const errors: string[] = [];
  validateNode(value, schema, "$", errors);
  return { valid: errors.length === 0, errors };
}

function validateNode(value: unknown, schema: JSONSchemaNode, path: string, errors: string[]): void {
  if (schema.type === "object") {
    validateObject(value, schema, path, errors);
    return;
  }
  if (schema.type === "array") {
    validateArray(value, schema, path, errors);
    return;
  }
  if (schema.type === "string") {
    validateString(value, schema, path, errors);
    return;
  }
  if (schema.type === "number") {
    validateNumber(value, schema, path, errors);
    return;
  }
  if (schema.type === "boolean" && typeof value !== "boolean") {
    errors.push(`${path}: boolean이 아닙니다`);
  }
}

function validateObject(value: unknown, schema: JSONSchemaNode, path: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${path}: object가 아닙니다`);
    return;
  }

  for (const key of schema.required ?? []) {
    if (!(key in value)) errors.push(`${path}.${key}: 필수 필드가 없습니다`);
  }

  for (const [key, propertySchema] of Object.entries(schema.properties ?? {})) {
    if (key in value) validateNode(value[key], propertySchema, `${path}.${key}`, errors);
  }
}

function validateArray(value: unknown, schema: JSONSchemaNode, path: string, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push(`${path}: array가 아닙니다`);
    return;
  }

  if (schema.items !== undefined) {
    const itemSchema = schema.items;
    value.forEach((item, index) => validateNode(item, itemSchema, `${path}[${index}]`, errors));
  }
}

function validateString(value: unknown, schema: JSONSchemaNode, path: string, errors: string[]): void {
  if (typeof value !== "string") {
    errors.push(`${path}: string이 아닙니다`);
    return;
  }

  if (schema.enum !== undefined && !schema.enum.includes(value)) {
    errors.push(`${path}: 허용된 값이 아닙니다 (${value})`);
  }

  if (schema.format === "date-time" && Number.isNaN(Date.parse(value))) {
    errors.push(`${path}: 유효한 날짜가 아닙니다 (${value})`);
  }
}

function validateNumber(value: unknown, schema: JSONSchemaNode, path: string, errors: string[]): void {
  if (typeof value !== "number" || Number.isNaN(value)) {
    errors.push(`${path}: number가 아닙니다`);
    return;
  }

  if (schema.minimum !== undefined && value < schema.minimum) {
    errors.push(`${path}: 최솟값(${schema.minimum}) 미만입니다`);
  }
  if (schema.maximum !== undefined && value > schema.maximum) {
    errors.push(`${path}: 최댓값(${schema.maximum}) 초과입니다`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
