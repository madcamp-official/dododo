import type { RawItem, SourceType } from "../../../shared/src/index.ts";

const SOURCE_TYPES: ReadonlySet<string> = new Set<SourceType>([
  "school-site",
  "school-email",
  "lms",
  "file",
  "calendar",
  "screen",
  "conversation",
]);

export function parseRawItem(value: unknown, fixturePath: string): RawItem {
  if (!isRecord(value)) {
    throw invalidFixture(fixturePath, "최상위 값은 객체여야 합니다");
  }

  const id = requireString(value, "id", fixturePath);
  const sourceId = requireString(value, "sourceId", fixturePath);
  const sourceType = requireSourceType(value.sourceType, fixturePath);
  const uri = requireString(value, "uri", fixturePath);
  const content = requireString(value, "content", fixturePath);
  const contentHash = requireString(value, "contentHash", fixturePath);
  const observedAt = requireString(value, "observedAt", fixturePath);

  if (Number.isNaN(Date.parse(observedAt))) {
    throw invalidFixture(fixturePath, "observedAt은 유효한 날짜여야 합니다");
  }

  if (!isRecord(value.metadata)) {
    throw invalidFixture(fixturePath, "metadata는 객체여야 합니다");
  }

  const externalId = optionalString(value.externalId, "externalId", fixturePath);
  const title = optionalString(value.title, "title", fixturePath);

  return {
    id,
    sourceId,
    sourceType,
    externalId,
    uri,
    title,
    content,
    contentHash,
    observedAt,
    metadata: structuredClone(value.metadata),
  };
}

function requireSourceType(value: unknown, fixturePath: string): SourceType {
  if (typeof value !== "string" || !SOURCE_TYPES.has(value)) {
    throw invalidFixture(fixturePath, "sourceType이 허용된 값이 아닙니다");
  }

  return value as SourceType;
}

function requireString(
  value: Record<string, unknown>,
  field: string,
  fixturePath: string,
): string {
  const fieldValue = value[field];
  if (typeof fieldValue !== "string" || fieldValue.trim() === "") {
    throw invalidFixture(fixturePath, `${field}은 비어 있지 않은 문자열이어야 합니다`);
  }

  return fieldValue;
}

function optionalString(
  value: unknown,
  field: string,
  fixturePath: string,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim() === "") {
    throw invalidFixture(fixturePath, `${field}은 문자열이어야 합니다`);
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidFixture(fixturePath: string, reason: string): Error {
  return new Error(`유효하지 않은 Fixture (${fixturePath}): ${reason}`);
}
