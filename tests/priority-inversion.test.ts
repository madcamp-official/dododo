import assert from "node:assert/strict";
import test from "node:test";

import type { ContextItem } from "../packages/shared/src/index.ts";
import type { RankedItem } from "../apps/cli/src/runtime/recommendationRanking.ts";
import { checkPriorityInversion, findPriorityInversion } from "../apps/cli/src/runtime/priorityInversion.ts";
import { rankItems } from "../apps/cli/src/runtime/recommendationRanking.ts";
import { runSync } from "../apps/cli/src/commands/sync.ts";
import { createCliContainer } from "../apps/cli/src/runtime/container.ts";

const NOW = new Date("2026-07-21T00:00:00+09:00");

function item(overrides: Partial<ContextItem> & { id: string }): ContextItem {
  return {
    kind: "task",
    title: overrides.id,
    status: "confirmed",
    requirements: [],
    tags: [],
    priority: 0,
    confidence: 1,
    evidenceIds: [],
    metadata: {},
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides,
  };
}

function ranked(entries: Array<{ id: string; score: number }>): RankedItem[] {
  return entries.map(({ id, score }) => ({ item: item({ id }), score, reason: "테스트" }));
}

test("findPriorityInversion은 현재 항목보다 순위가 높은 항목이 있으면 최상위 항목을 알려준다", () => {
  const list = ranked([{ id: "top", score: 90 }, { id: "middle", score: 60 }, { id: "current", score: 30 }]);

  const inversion = findPriorityInversion(list, "current");

  assert.ok(inversion !== undefined);
  assert.equal(inversion.currentItem.id, "current");
  assert.equal(inversion.currentScore, 30);
  assert.equal(inversion.topItem.id, "top");
  assert.equal(inversion.topScore, 90);
});

test("findPriorityInversion은 현재 항목이 이미 최상위면 역전이 아니다", () => {
  const list = ranked([{ id: "current", score: 90 }, { id: "second", score: 60 }]);

  assert.equal(findPriorityInversion(list, "current"), undefined);
});

test("findPriorityInversion은 현재 항목이 순위 목록에 없으면 판정하지 않는다", () => {
  const list = ranked([{ id: "top", score: 90 }, { id: "second", score: 60 }]);

  assert.equal(findPriorityInversion(list, "missing"), undefined);
});

test("findPriorityInversion은 빈 목록이면 undefined를 반환한다", () => {
  assert.equal(findPriorityInversion([], "current"), undefined);
});

test("findPriorityInversion은 동점이면 역전으로 보지 않는다", () => {
  const list = ranked([{ id: "top", score: 50 }, { id: "current", score: 50 }]);

  assert.equal(findPriorityInversion(list, "current"), undefined);
});

test("checkPriorityInversion은 실제 container의 순위 계산 결과로 역전을 판정한다", async () => {
  const container = createCliContainer({ databasePath: ":memory:" });
  await runSync(container);
  const existingTasks = await container.repository.listContextItems("task");
  const existingCurrent = existingTasks[0];
  assert.ok(existingCurrent !== undefined, "fixture에 Task가 있어야 함");

  // fixture 항목끼리는 점수가 동점일 수 있어(rankItems 자체 테스트로 이미 확인),
  // 마감이 1시간 뒤인 새 Task를 추가해 확실한 최상위 항목을 만든다.
  const urgentTask: ContextItem = {
    ...item({ id: "ctx-urgent", title: "긴급 과제" }),
    deadline: new Date(NOW.getTime() + 60 * 60 * 1000).toISOString(),
  };
  await container.repository.saveContextItems([urgentTask]);

  const inversion = await checkPriorityInversion(container, existingCurrent.id, NOW);

  assert.ok(inversion !== undefined, "마감이 훨씬 급한 새 Task가 있으면 역전이 감지돼야 함");
  assert.equal(inversion?.topItem.id, "ctx-urgent");
  assert.equal(inversion?.currentItem.id, existingCurrent.id);
});

test("checkPriorityInversion은 이미 가장 급한 항목을 보고 있으면 역전이 아니다", async () => {
  const container = createCliContainer({ databasePath: ":memory:" });
  await runSync(container);
  const urgentTask: ContextItem = {
    ...item({ id: "ctx-urgent", title: "긴급 과제" }),
    deadline: new Date(NOW.getTime() + 60 * 60 * 1000).toISOString(),
  };
  await container.repository.saveContextItems([urgentTask]);

  assert.equal(await checkPriorityInversion(container, "ctx-urgent", NOW), undefined);
});

test("checkPriorityInversion은 존재하지 않는 id면 undefined를 반환한다", async () => {
  const container = createCliContainer({ databasePath: ":memory:" });
  await runSync(container);

  assert.equal(await checkPriorityInversion(container, "no-such-id", NOW), undefined);
});
