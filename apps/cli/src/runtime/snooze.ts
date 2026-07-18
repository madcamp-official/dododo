import type { ContextItem } from "../../../../packages/shared/src/index.ts";

// domain.ts에 snooze 전용 필드가 없어서 ContextItem.metadata에 ISO 문자열로 보관한다.
// context-repository-contract-extension.md 제안이 합의되면 Recommendation.suppressedUntil
// 기반 억제로 옮길 수 있다.
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
