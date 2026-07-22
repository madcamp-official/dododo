import assert from "node:assert/strict";
import test from "node:test";

import type { ContextItem } from "../packages/shared/src/index.ts";
import type { RankedItem } from "../apps/cli/src/runtime/recommendationRanking.ts";
import { checkPriorityInversion, findPriorityInversion } from "../apps/cli/src/runtime/priorityInversion.ts";
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

test("findPriorityInversion은 입력이 정렬되지 않아도 실제 최고 점수 항목을 찾는다", () => {
  const list = ranked([{ id: "current", score: 30 }, { id: "middle", score: 60 }, { id: "top", score: 90 }]);

  const inversion = findPriorityInversion(list, "current");

  assert.equal(inversion?.topItem.id, "top");
  assert.equal(inversion?.topScore, 90);
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
  const currentTask: ContextItem = {
    ...item({ id: "ctx-current", title: "현재 과제" }),
    deadline: new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  };
  const urgentTask: ContextItem = {
    ...item({ id: "ctx-urgent", title: "긴급 과제" }),
    deadline: new Date(NOW.getTime() + 60 * 60 * 1000).toISOString(),
  };
  await container.repository.saveContextItems([currentTask, urgentTask]);

  const inversion = await checkPriorityInversion(container, currentTask.id, NOW);

  assert.ok(inversion !== undefined, "마감이 훨씬 급한 새 Task가 있으면 역전이 감지돼야 함");
  assert.equal(inversion?.topItem.id, "ctx-urgent");
  assert.equal(inversion?.currentItem.id, currentTask.id);
});

test("checkPriorityInversion은 이미 가장 급한 항목을 보고 있으면 역전이 아니다", async () => {
  const container = createCliContainer({ databasePath: ":memory:" });
  const urgentTask: ContextItem = {
    ...item({ id: "ctx-urgent", title: "긴급 과제" }),
    deadline: new Date(NOW.getTime() + 60 * 60 * 1000).toISOString(),
  };
  const relaxedTask: ContextItem = {
    ...item({ id: "ctx-relaxed", title: "여유 있는 과제" }),
    deadline: new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  };
  await container.repository.saveContextItems([urgentTask, relaxedTask]);

  assert.equal(await checkPriorityInversion(container, "ctx-urgent", NOW), undefined);
});

test("checkPriorityInversion은 실제 점수 계산 결과가 동점이면 역전으로 보지 않는다", async () => {
  const container = createCliContainer({ databasePath: ":memory:" });
  const deadline = new Date(NOW.getTime() + 24 * 60 * 60 * 1000).toISOString();
  await container.repository.saveContextItems([
    { ...item({ id: "ctx-current" }), deadline },
    { ...item({ id: "ctx-peer" }), deadline },
  ]);

  assert.equal(await checkPriorityInversion(container, "ctx-current", NOW), undefined);
});

test("checkPriorityInversion은 존재하지 않는 id면 undefined를 반환한다", async () => {
  const container = createCliContainer({ databasePath: ":memory:" });

  assert.equal(await checkPriorityInversion(container, "no-such-id", NOW), undefined);
});
