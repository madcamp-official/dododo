import assert from "node:assert/strict";
import test from "node:test";

import type { ContextItem, Recommendation, SyncResult } from "../packages/shared/src/index.ts";
import { classifyRecommendation } from "../apps/desktop/src/main/notifier/classifyNotification.ts";
import { toConflictEvents } from "../apps/desktop/src/main/watch/conflictEvents.ts";
import { summarizeSyncForNotification } from "../apps/desktop/src/main/watch/syncCompleteSummary.ts";

function opportunity(): ContextItem {
  return {
    id: "ctx-opportunity-1",
    kind: "opportunity",
    title: "해커톤 모집",
    status: "confirmed",
    requirements: [],
    tags: [],
    priority: 0,
    confidence: 1,
    evidenceIds: [],
    metadata: {},
    createdAt: "2026-07-21T00:00:00Z",
    updatedAt: "2026-07-21T00:00:00Z",
  };
}

function task(): ContextItem {
  return { ...opportunity(), id: "ctx-task-1", kind: "task" };
}

function recommendation(contextItemId: string): Recommendation {
  return {
    id: "rec-1",
    contextItemId,
    action: "확인하세요",
    reason: "마감이 가깝습니다",
    score: 90,
    evidenceIds: [],
    createdAt: "2026-07-21T09:00:00Z",
  };
}

test("classifyRecommendation은 opportunity item만 조용한 알림으로 분류한다", () => {
  const event = classifyRecommendation(opportunity(), recommendation("ctx-opportunity-1"));

  assert.ok(event !== undefined);
  assert.equal(event.kind, "opportunity");
  assert.equal(event.contextItemId, "ctx-opportunity-1");
  assert.equal(event.message, "마감이 가깝습니다");
});

test("classifyRecommendation은 task/event item은 분류하지 않는다(undefined)", () => {
  assert.equal(classifyRecommendation(task(), recommendation("ctx-task-1")), undefined);
});

test("classifyRecommendation은 item을 못 찾으면 분류하지 않는다(undefined)", () => {
  assert.equal(classifyRecommendation(undefined, recommendation("ctx-missing")), undefined);
});

function syncResult(created: number): SyncResult {
  return { sourceId: "school-site-main", collected: created + 1, created, updated: 0, skipped: 0, errors: [] };
}

test("summarizeSyncForNotification은 새 항목이 있으면 sync-complete 이벤트를 만든다", () => {
  const now = new Date("2026-07-21T09:00:00Z");

  const event = summarizeSyncForNotification([syncResult(2), syncResult(1)], now);

  assert.ok(event !== undefined);
  assert.equal(event.kind, "sync-complete");
  assert.equal(event.message, "새 항목 3건을 확인했습니다.");
  assert.equal(event.createdAt, now.toISOString());
});

test("summarizeSyncForNotification은 새 항목이 없으면 undefined를 반환한다", () => {
  const now = new Date("2026-07-21T09:00:00Z");

  assert.equal(summarizeSyncForNotification([syncResult(0), syncResult(0)], now), undefined);
  assert.equal(summarizeSyncForNotification([], now), undefined);
});

test("toConflictEvents는 겹치는 두 일정을 conflict 이벤트로 바꾼다", () => {
  const now = new Date("2026-07-21T09:00:00Z");
  const a = { ...opportunity(), id: "evt-a", kind: "event" as const, title: "영민이와 복싱 스파링" };
  const b = { ...opportunity(), id: "evt-b", kind: "event" as const, title: "춘봉이와 저녁" };

  const events = toConflictEvents([{ a, b }], now);

  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "conflict");
  assert.equal(events[0].contextItemId, "evt-a");
  assert.equal(events[0].message, "\"영민이와 복싱 스파링\"와(과) \"춘봉이와 저녁\" 일정이 겹칩니다.");
  assert.equal(events[0].createdAt, now.toISOString());
});
