import type { ContextItem } from "../../../../packages/shared/src/index.ts";

// domain.ts에 snooze 전용 필드가 없어서 ContextItem.metadata에 ISO 문자열로 보관한다.
// 같은 관례를 packages/context-engine/src/recommendation/priority.ts와
// packages/context-engine/src/intent/qa.ts도 독립적으로 읽는다 — 도메인 필드로
// 승격하면(공동 소유 계약 변경 절차 필요) 세 곳을 한 번에 정리할 수 있다.
const SNOOZED_UNTIL_KEY = "snoozedUntil";

export function isSnoozed(item: ContextItem, now: Date): boolean {
  const value = item.metadata[SNOOZED_UNTIL_KEY];
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) && new Date(value) > now;
}

export function withSnooze(item: ContextItem, until: Date): ContextItem {
  return {
    ...structuredClone(item),
    metadata: { ...item.metadata, [SNOOZED_UNTIL_KEY]: until.toISOString() },
  };
}

export function snoozedUntil(item: ContextItem): string | undefined {
  const value = item.metadata[SNOOZED_UNTIL_KEY];
  return typeof value === "string" ? value : undefined;
}
