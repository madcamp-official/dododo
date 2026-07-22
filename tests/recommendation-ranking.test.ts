import assert from "node:assert/strict";
import test from "node:test";

import { rankItems } from "../apps/cli/src/runtime/recommendationRanking.ts";
import type { CliContainer } from "../apps/cli/src/runtime/container.ts";
import type { ContextItem } from "../packages/shared/src/index.ts";

test("직접 여는 추천 목록은 최근 알림 중복 억제로 항목을 숨기지 않는다", async () => {
  const item: ContextItem = {
    id: "opportunity-1",
    kind: "opportunity",
    title: "AI 공모전 참가자 모집",
    status: "new",
    priority: 0,
    confidence: 0.9,
    evidenceIds: ["evidence-1"],
    requirements: [],
    tags: ["AI"],
    metadata: {},
    createdAt: "2026-07-22T00:00:00Z",
    updatedAt: "2026-07-22T00:00:00Z",
  };
  const container = {
    profileRepository: { get: async () => undefined },
    // 알림용 engine은 최근 30분 이력 때문에 빈 배열을 반환하는 상황을 재현한다.
    recommendationEngine: { recommend: async () => [] },
  } as unknown as CliContainer;

  const ranked = await rankItems(container, [item], new Date("2026-07-22T01:00:00Z"));

  assert.equal(ranked.length, 1);
  assert.equal(ranked[0]?.item.id, item.id);
  assert.equal(typeof ranked[0]?.reason, "string");
});
