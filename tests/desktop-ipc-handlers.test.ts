import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  handleAddSubmit,
  handleAsk,
  handleProfileSave,
  handleTaskComplete,
  handleTaskDetail,
  handleTaskSnooze,
  handleUiStateGet,
  handleUiStateSet,
} from "../apps/desktop/src/main/ipc/handlers.ts";
import { runSync } from "../apps/cli/src/commands/sync.ts";
import { createCliContainer } from "../apps/cli/src/runtime/container.ts";

async function seededContainer() {
  const container = createCliContainer({ databasePath: ":memory:" });
  await runSync(container);
  const tasks = await container.repository.listContextItems("task");
  return { container, taskId: tasks[0]?.id as string };
}

// doyeonid 리뷰(PR #60): askQuestion/submitAdd 같은 내부 함수가 아니라, ipcMain.handle이
// 실제로 부르는 handlers.ts의 경계 함수 자체를 검증한다 — 잘못된 payload가 예외를
// 던지지 않고 { ok: false, error.code: "validation" }으로 나오는지가 핵심이다.
function assertValidationFailure(result: { ok: boolean; error?: { code: string } }) {
  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "validation");
}

test("handleAsk는 undefined/null/{}/잘못된 타입 payload를 모두 validation으로 거절한다", async () => {
  const { container } = await seededContainer();

  assertValidationFailure(await handleAsk(container, undefined));
  assertValidationFailure(await handleAsk(container, null));
  assertValidationFailure(await handleAsk(container, {}));
  assertValidationFailure(await handleAsk(container, { question: 1 }));
});

test("handleAsk는 올바른 payload는 정상 처리한다", async () => {
  const { container } = await seededContainer();

  const result = await handleAsk(container, { question: "오늘 뭐부터 해야 해?" });

  assert.equal(result.ok, true);
});

test("handleAddSubmit은 null/필수 필드 누락/선택 필드 잘못된 타입을 모두 거절한다", async () => {
  const { container } = await seededContainer();

  assertValidationFailure(await handleAddSubmit(container, null));
  assertValidationFailure(await handleAddSubmit(container, { title: "약속" })); // date/time 누락
  assertValidationFailure(await handleAddSubmit(container, {
    title: "약속", date: "2026-07-25", time: "10:00", endTime: 123, // 선택 필드 타입 오류
  }));
  assertValidationFailure(await handleAddSubmit(container, {
    title: "약속", date: "2026-07-25", time: "10:00", reminderOffsetMinutes: "60", // 문자열
  }));
});

test("handleAddSubmit은 올바른 payload는 정상 처리한다", async () => {
  const { container } = await seededContainer();

  const result = await handleAddSubmit(container, { title: "약속", date: "2026-07-25", time: "10:00" });

  assert.equal(result.ok, true);
});

test("handleTaskDetail/handleTaskComplete는 누락되거나 빈 id를 거절한다", async () => {
  const { container } = await seededContainer();

  assertValidationFailure(await handleTaskDetail(container, {}));
  assertValidationFailure(await handleTaskDetail(container, { id: "" }));
  assertValidationFailure(await handleTaskDetail(container, { id: "   " }));
  assertValidationFailure(await handleTaskDetail(container, { id: 123 }));

  assertValidationFailure(await handleTaskComplete(container, {}));
  assertValidationFailure(await handleTaskComplete(container, { id: "" }));
});

test("handleTaskSnooze는 잘못된 id 또는 until을 거절한다", async () => {
  const { container, taskId } = await seededContainer();

  assertValidationFailure(await handleTaskSnooze(container, { id: "", until: "2026-07-25T00:00:00+09:00" }));
  assertValidationFailure(await handleTaskSnooze(container, { id: taskId, until: 123 }));
  assertValidationFailure(await handleTaskSnooze(container, { id: taskId })); // until 누락

  const ok = await handleTaskSnooze(container, { id: taskId, until: "2026-07-25T00:00:00+09:00" });
  assert.equal(ok.ok, true);
});

const validProfile = {
  school: "테스트대", major: "컴퓨터공학", year: "3",
  interests: [], activityTypes: [], preferredLocations: [], explicitConstraints: [],
};

test("handleProfileSave는 null/필수 필드 누락/잘못된 타입 payload를 모두 validation으로 거절한다", async () => {
  const { container } = await seededContainer();

  assertValidationFailure(await handleProfileSave(container, null));
  assertValidationFailure(await handleProfileSave(container, {}));
  assertValidationFailure(await handleProfileSave(container, { ...validProfile, school: 1 }));
  assertValidationFailure(await handleProfileSave(container, { ...validProfile, interests: "AI" }));
});

test("handleProfileSave는 올바른 payload는 정상 처리한다", async () => {
  const { container } = await seededContainer();

  const result = await handleProfileSave(container, validProfile);

  assert.equal(result.ok, true);
});

test("handleUiStateGet/handleUiStateSet은 잘못된 payload를 validation으로 거절한다", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dododo-ui-state-handlers-"));
  const filePath = join(dir, "ui-state.json");
  try {
    assertValidationFailure(await handleUiStateGet(filePath, undefined));
    assertValidationFailure(await handleUiStateGet(filePath, {}));
    assertValidationFailure(await handleUiStateGet(filePath, { key: 1 }));

    assertValidationFailure(await handleUiStateSet(filePath, undefined));
    assertValidationFailure(await handleUiStateSet(filePath, { key: "lastGreetingDate" })); // value 누락
    assertValidationFailure(await handleUiStateSet(filePath, { key: "" , value: 1 }));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("handleUiStateGet/handleUiStateSet은 올바른 payload로 값을 왕복 저장한다", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dododo-ui-state-handlers-"));
  const filePath = join(dir, "ui-state.json");
  try {
    const setResult = await handleUiStateSet(filePath, { key: "lastGreetingDate", value: "2026-07-21" });
    assert.equal(setResult.ok, true);

    const getResult = await handleUiStateGet(filePath, { key: "lastGreetingDate" });
    assert.equal(getResult.ok, true);
    if (getResult.ok) assert.equal(getResult.data, "2026-07-21");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
