import assert from "node:assert/strict";
import test from "node:test";

import { runCalendar } from "../apps/cli/src/commands/calendar.ts";
import { createCliContainer } from "../apps/cli/src/runtime/container.ts";
import type { ContextItem } from "../packages/shared/src/index.ts";

test("calendar week는 이번 주 Task 마감과 Event를 시간순으로 표시한다", async () => {
  const container = createCliContainer({ databasePath: ":memory:" });
  try {
    await container.repository.saveContextItems([
      scheduledItem({
        id: "task-os-3",
        kind: "task",
        title: "운영체제 과제 3",
        deadline: "2026-07-22T23:59:00+09:00",
      }),
      scheduledItem({
        id: "event-os-final",
        kind: "event",
        title: "운영체제 기말시험 안내",
        startAt: "2026-07-23T14:00:00+09:00",
      }),
    ]);
    const output = await runCalendar(
      container,
      ["week"],
      new Date("2026-07-20T10:00:00+09:00"),
    );

    assert.match(output, /Calendar — 이번 주/);
    assert.match(output, /운영체제 과제 3/);
    assert.match(output, /운영체제 기말시험 안내/);
    assert.ok(output.indexOf("운영체제 과제 3") < output.indexOf("운영체제 기말시험 안내"));
  } finally {
    container.close();
  }
});

function scheduledItem(overrides: Partial<ContextItem>): ContextItem {
  return {
    id: "scheduled-item",
    kind: "task",
    title: "일정",
    status: "todo",
    requirements: [],
    tags: [],
    priority: 0,
    confidence: 1,
    evidenceIds: [],
    metadata: {},
    createdAt: "2026-07-20T10:00:00+09:00",
    updatedAt: "2026-07-20T10:00:00+09:00",
    ...overrides,
  };
}

test("calendar는 week 외 사용법을 안내하고 빈 주를 정상 처리한다", async () => {
  const container = createCliContainer({ databasePath: ":memory:" });
  try {
    assert.match(await runCalendar(container, []), /calendar week/);
    assert.match(
      await runCalendar(container, ["week"], new Date("2030-01-01T10:00:00+09:00")),
      /등록된 일정이나 마감이 없습니다/,
    );
  } finally {
    container.close();
  }
});

test("calendar는 잘못된 날짜와 종료된 항목을 제외하고 정상 일정은 보여준다", async () => {
  const container = createCliContainer({ databasePath: ":memory:" });
  try {
    await container.repository.saveContextItems([
      scheduledItem({ id: "invalid", title: "깨진 마감", deadline: "잘못된 날짜" }),
      scheduledItem({
        id: "done",
        title: "완료한 과제",
        status: "done",
        deadline: "2026-07-21T18:00:00+09:00",
      }),
      scheduledItem({
        id: "active",
        title: "진행 중인 과제",
        deadline: "2026-07-22T18:00:00+09:00",
      }),
    ]);
    const output = await runCalendar(
      container,
      ["week"],
      new Date("2026-07-20T10:00:00+09:00"),
    );
    assert.doesNotMatch(output, /깨진 마감|완료한 과제/);
    assert.match(output, /진행 중인 과제/);
  } finally {
    container.close();
  }
});
