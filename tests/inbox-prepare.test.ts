import assert from "node:assert/strict";
import test from "node:test";

import { runInbox } from "../apps/cli/src/commands/inbox.ts";
import { runSync } from "../apps/cli/src/commands/sync.ts";
import { createCliContainer } from "../apps/cli/src/runtime/container.ts";
import { prepareOpportunity } from "../packages/context-engine/src/index.ts";
import type { ContextItem } from "../packages/shared/src/index.ts";

const NOW = new Date("2026-07-20T10:00:00+09:00");

test("inbox prepare는 Opportunity를 준비 상태로 바꾸고 Task와 마감 Event를 생성한다", async () => {
  const container = createCliContainer({ databasePath: ":memory:" });
  try {
    await runSync(container, NOW);
    const [opportunity] = await container.repository.listContextItems("opportunity");
    assert.ok(opportunity);

    const output = await runInbox(container, ["prepare", opportunity.id], NOW);
    assert.match(output, /준비를 시작했습니다/);

    const updated = await container.repository.findContextItem(opportunity.id);
    assert.equal(updated?.status, "preparing");
    const derived = (await container.repository.listContextItems()).filter(
      (item) => item.metadata.parentOpportunityId === opportunity.id,
    );
    assert.ok(derived.some((item) => item.kind === "task"));
    if (opportunity.deadline !== undefined) {
      const event = derived.find((item) => item.kind === "event");
      assert.equal(event?.startAt, opportunity.deadline);
    }
    for (const item of derived) assert.deepEqual(item.evidenceIds, opportunity.evidenceIds);

    const opportunityHistory = await container.repository.listContextHistory(opportunity.id);
    assert.ok(opportunityHistory.some((event) => event.changeType === "status_changed"));
    for (const item of derived) {
      const history = await container.repository.listContextHistory(item.id);
      assert.ok(history.some((event) => event.changeType === "created"));
    }

    assert.match(await runInbox(container, ["prepare", opportunity.id], NOW), /이미 준비 중/);
  } finally {
    container.close();
  }
});

test("inbox prepare는 종료·취소·Dismiss·만료 Opportunity를 다시 활성화하지 않는다", async () => {
  for (const status of ["done", "cancelled", "dismissed", "expired"] as const) {
    const container = createCliContainer({ databasePath: ":memory:" });
    try {
      const opportunity = opportunityItem({ id: `opportunity-${status}`, status });
      await container.repository.saveContextItems([opportunity]);
      const output = await runInbox(container, ["prepare", opportunity.id], NOW);
      assert.match(output, /종료된 Opportunity/);
      assert.equal((await container.repository.findContextItem(opportunity.id))?.status, status);
      assert.equal(
        (await container.repository.listContextItems()).filter(
          (item) => item.metadata.parentOpportunityId === opportunity.id,
        ).length,
        0,
      );
    } finally {
      container.close();
    }
  }
});

test("준비 Task ID는 requirements 순서가 바뀌어도 같은 요구사항을 가리킨다", () => {
  const original = opportunityItem({ requirements: ["참가 신청서", "개인정보 동의서"] });
  const reordered = opportunityItem({ requirements: ["개인정보 동의서", "참가 신청서"] });

  const first = prepareOpportunity(original, NOW);
  const second = prepareOpportunity(reordered, NOW);
  assert.deepEqual(
    new Map(second.tasks.map((task) => [task.title, task.id])),
    new Map(first.tasks.map((task) => [task.title, task.id])),
  );
  assert.equal(new Set(first.tasks.map((task) => task.id)).size, first.tasks.length);
  assert.deepEqual(prepareOpportunity(original, NOW).history, first.history);
});

function opportunityItem(overrides: Partial<ContextItem> = {}): ContextItem {
  return {
    id: "opportunity-1",
    kind: "opportunity",
    title: "AI 해커톤",
    status: "new",
    deadline: "2026-07-25T18:00:00+09:00",
    requirements: ["참가 신청서"],
    tags: ["AI"],
    priority: 0,
    confidence: 0.9,
    evidenceIds: ["evidence-opportunity"],
    metadata: {},
    createdAt: "2026-07-19T10:00:00+09:00",
    updatedAt: "2026-07-19T10:00:00+09:00",
    ...overrides,
  };
}

test("inbox prepare는 잘못된 ID와 Opportunity가 아닌 항목을 거부한다", async () => {
  const container = createCliContainer({ databasePath: ":memory:" });
  try {
    await runSync(container, NOW);
    const [task] = await container.repository.listContextItems("task");
    assert.ok(task);
    assert.match(await runInbox(container, ["prepare", "missing"], NOW), /찾을 수 없습니다/);
    assert.match(await runInbox(container, ["prepare", task.id], NOW), /Opportunity여야/);
    assert.match(await runInbox(container, ["unknown"], NOW), /사용법/);
  } finally {
    container.close();
  }
});
