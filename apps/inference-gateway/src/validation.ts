import type { JSONSchemaNode, RemoteInferenceRequest } from "../../../packages/context-engine/src/index.ts";
import type { GatewayConfig } from "./config.ts";

export class RequestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RequestValidationError";
  }
}

export function validateInferenceRequest(value: unknown, config: GatewayConfig): RemoteInferenceRequest {
  if (!isRecord(value)) throw invalid("요청 본문은 JSON object여야 합니다");
  if (value.modelKind !== "text" && value.modelKind !== "vision") {
    throw invalid("modelKind는 text 또는 vision이어야 합니다");
  }
  const systemPrompt = text(value.systemPrompt, "systemPrompt");
  const userPrompt = text(value.userPrompt, "userPrompt");
  const textBytes = Buffer.byteLength(systemPrompt) + Buffer.byteLength(userPrompt);
  if (textBytes > config.maxTextBytes) throw invalid(`프롬프트는 최대 ${config.maxTextBytes} bytes입니다`);

  const schemaBytes = Buffer.byteLength(JSON.stringify(value.schema));
  if (schemaBytes > config.maxSchemaBytes) throw invalid(`Schema는 최대 ${config.maxSchemaBytes} bytes입니다`);
  const schema = validateSchema(value.schema);

  let images: string[] | undefined;
  if (value.images !== undefined) {
    if (!Array.isArray(value.images) || value.images.some((image) => typeof image !== "string")) {
      throw invalid("images는 base64 문자열 배열이어야 합니다");
    }
    if (value.images.length > config.maxImages) throw invalid(`이미지는 최대 ${config.maxImages}개입니다`);
    images = value.images as string[];
    for (const image of images) {
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(image) || image.length % 4 !== 0) {
        throw invalid("이미지는 data URL이 아닌 유효한 base64 문자열이어야 합니다");
      }
      if (Buffer.byteLength(image, "base64") > config.maxImageBytes) {
        throw invalid(`이미지는 각각 최대 ${config.maxImageBytes} bytes입니다`);
      }
    }
  }

  const timeoutMs = optionalPositiveInteger(value.timeoutMs, "timeoutMs");
  if (timeoutMs !== undefined && timeoutMs > config.ollamaTimeoutMs) {
    throw invalid(`timeoutMs는 서버 상한 ${config.ollamaTimeoutMs}ms 이하여야 합니다`);
  }
  const temperature = optionalFiniteNumber(value.temperature, "temperature");
  if (temperature !== undefined && (temperature < 0 || temperature > 2)) {
    throw invalid("temperature는 0 이상 2 이하여야 합니다");
  }

  return {
    modelKind: value.modelKind,
    systemPrompt,
    userPrompt,
    schema,
    ...(images === undefined ? {} : { images }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(temperature === undefined ? {} : { temperature }),
  };
}

function validateSchema(value: unknown): JSONSchemaNode {
  const state = { nodes: 0 };
  return schemaNode(value, 0, state);
}

function schemaNode(value: unknown, depth: number, state: { nodes: number }): JSONSchemaNode {
  if (!isRecord(value)) throw invalid("Schema node는 object여야 합니다");
  if (depth > 10) throw invalid("Schema 깊이는 최대 10입니다");
  state.nodes += 1;
  if (state.nodes > 200) throw invalid("Schema node는 최대 200개입니다");
  if (!isSchemaType(value.type)) throw invalid("Schema type이 허용 범위를 벗어났습니다");

  const result: JSONSchemaNode = { type: value.type };
  if (value.properties !== undefined) {
    if (value.type !== "object" || !isRecord(value.properties)) throw invalid("properties는 object Schema에서만 사용합니다");
    result.properties = Object.fromEntries(Object.entries(value.properties).map(
      ([key, child]) => [key, schemaNode(child, depth + 1, state)],
    ));
  }
  if (value.required !== undefined) {
    if (value.type !== "object" || !isStringArray(value.required)) throw invalid("required는 문자열 배열이어야 합니다");
    result.required = value.required;
  }
  if (value.items !== undefined) {
    if (value.type !== "array") throw invalid("items는 array Schema에서만 사용합니다");
    result.items = schemaNode(value.items, depth + 1, state);
  }
  if (value.enum !== undefined) {
    if (value.type !== "string" || !isStringArray(value.enum)) throw invalid("enum은 문자열 배열이어야 합니다");
    result.enum = value.enum;
  }
  if (value.minimum !== undefined) result.minimum = finiteNumber(value.minimum, "minimum");
  if (value.maximum !== undefined) result.maximum = finiteNumber(value.maximum, "maximum");
  if (value.format !== undefined) {
    if (value.type !== "string" || value.format !== "date-time") throw invalid("지원하지 않는 Schema format입니다");
    result.format = "date-time";
  }
  return result;
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") throw invalid(`${field}는 비어 있지 않은 문자열이어야 합니다`);
  return value;
}

function optionalPositiveInteger(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || (value as number) <= 0) throw invalid(`${field}는 0보다 큰 정수여야 합니다`);
  return value as number;
}

function optionalFiniteNumber(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  return finiteNumber(value, field);
}

function finiteNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw invalid(`${field}는 유한한 숫자여야 합니다`);
  return value;
}

function isSchemaType(value: unknown): value is JSONSchemaNode["type"] {
  return value === "object" || value === "array" || value === "string"
    || value === "number" || value === "boolean";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(message: string): RequestValidationError {
  return new RequestValidationError(message);
}
