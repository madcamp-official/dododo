import assert from "node:assert/strict";
import test from "node:test";

import { runAsk } from "../apps/cli/src/commands/ask.ts";
import { createCliContainer } from "../apps/cli/src/runtime/container.ts";
import type { ContextItem } from "../packages/shared/src/index.ts";

function taskItem(overrides: Partial<ContextItem> = {}): ContextItem {
  return {
    id: "task-os",
    kind: "task",
    title: "운영체제 과제 보고서 작성",
    status: "new",
    deadline: "2026-07-21T23:59:00+09:00",
    requirements: ["보고서"],
    tags: [],
    priority: 0,
    confidence: 0.9,
    evidenceIds: ["evidence-1"],
    metadata: {},
    createdAt: "2026-07-18T00:00:00+09:00",
    updatedAt: "2026-07-18T00:00:00+09:00",
    ...overrides,
  };
}

test("ask는 질문이 비어있으면 사용법을 보여준다", async () => {
  const container = createCliContainer();
  const output = await runAsk(container, []);
  assert.match(output, /사용법: dododo ask/);
});

test("ask는 관련 Context가 없으면 모른다고 답한다", async () => {
  const container = createCliContainer();
  const output = await runAsk(container, ["오늘", "뭐", "해야", "돼?"]);
  assert.match(output, /관련 정보를 찾지 못했습니다/);
});

test("ask는 관련 Task를 찾으면 결정론적 템플릿으로 답하고 근거를 표시한다(provider 없음)", async () => {
  const container = createCliContainer();
  await container.repository.saveContextItems([taskItem()]);

  const output = await runAsk(container, ["운영체제", "과제", "뭐부터", "하지?"]);

  assert.match(output, /운영체제 과제 보고서 작성/);
  assert.match(output, /근거: evidence-1/);
});
