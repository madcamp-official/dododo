import { createHash } from "node:crypto";

import type { RawItem } from "../../../shared/src/index.ts";

export interface ScreenActivityFixture {
  observedAt: string;
  applicationHint: string;
  activity: string;
  relatedTaskCandidate?: string;
  confidence: number;
}

// fixtures/screen/*.json은 원본 스크린샷이 아니라 사전 추출된 활동 요약이다
// (AGENTS.md: 화면 캡처 원본은 영구 저장하지 않는다). 이 함수는 그 모양을 검증만
// 하고, 실제 RawItem 변환은 toRawItem이 한다.
export function parseScreenFixture(value: unknown, fixturePath: string): ScreenActivityFixture {
  if (!isRecord(value)) {
    throw invalidFixture(fixturePath, "최상위 값은 객체여야 합니다");
  }

  const observedAt = requireString(value, "observedAt", fixturePath);
  if (Number.isNaN(Date.parse(observedAt))) {
    throw invalidFixture(fixturePath, "observedAt은 유효한 날짜여야 합니다");
  }

  const applicationHint = requireString(value, "applicationHint", fixturePath);
  const activity = requireString(value, "activity", fixturePath);
  const confidence = requireConfidence(value, fixturePath);
  const relatedTaskCandidate = optionalString(value.relatedTaskCandidate, "relatedTaskCandidate", fixturePath);

  return { observedAt, applicationHint, activity, relatedTaskCandidate, confidence };
}

// 원본 캡처 바이트는 어디에도 들어가지 않는다 — content는 활동 요약 텍스트뿐이다.
export function toRawItem(fixture: ScreenActivityFixture, sourceId: string): RawItem {
  const contentHash = createHash("sha256").update(fixture.activity, "utf8").digest("hex");
  const metadata: Record<string, unknown> = {
    applicationHint: fixture.applicationHint,
    confidence: fixture.confidence,
  };
  if (fixture.relatedTaskCandidate !== undefined) {
    metadata.relatedTaskCandidate = fixture.relatedTaskCandidate;
  }

  return {
    id: `${sourceId}-${contentHash.slice(0, 12)}`,
    sourceId,
    sourceType: "screen",
    externalId: fixture.observedAt,
    uri: `screen://${sourceId}/${encodeURIComponent(fixture.observedAt)}`,
    title: fixture.applicationHint,
    content: fixture.activity,
    contentHash,
    observedAt: fixture.observedAt,
    metadata,
  };
}

function requireConfidence(value: Record<string, unknown>, fixturePath: string): number {
  const raw = value.confidence;
  if (typeof raw !== "number" || Number.isNaN(raw) || raw < 0 || raw > 1) {
    throw invalidFixture(fixturePath, "confidence는 0과 1 사이의 숫자여야 합니다");
  }
  return raw;
}

function requireString(value: Record<string, unknown>, field: string, fixturePath: string): string {
  const fieldValue = value[field];
  if (typeof fieldValue !== "string" || fieldValue.trim() === "") {
    throw invalidFixture(fixturePath, `${field}은 비어 있지 않은 문자열이어야 합니다`);
  }
  return fieldValue;
}

function optionalString(value: unknown, field: string, fixturePath: string): string | undefined {
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
  return new Error(`유효하지 않은 화면 활동 Fixture (${fixturePath}): ${reason}`);
}
