import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  handleAddSubmit,
  handleAsk,
  handleProfileSave,
  handleSourceRegister,
  handleSourceRemove,
  handleTaskComplete,
  handleTaskDetail,
  handleTaskSetReminderOffset,
  handleTaskSnooze,
  handleUiStateGet,
  handleUiStateSet,
} from "../apps/desktop/src/main/ipc/handlers.ts";
import { runSync } from "../apps/cli/src/commands/sync.ts";
import { createCliContainer } from "../apps/cli/src/runtime/container.ts";

// doyeonid 리뷰(PR #67) 1번 반영 후, DODODO_SOURCE_CONFIG로 명시한 경로에 파일이
// 없으면 에러를 던진다 — 빈 설정 파일을 미리 만들어 둔다.
async function withTempSourceConfig(fn: () => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "dododo-handlers-source-"));
  const configPath = join(directory, "dododo.sources.json");
  await writeFile(configPath, "{}\n", "utf8");
  const original = process.env.DODODO_SOURCE_CONFIG;
  process.env.DODODO_SOURCE_CONFIG = configPath;
  try {
    await fn();
  } finally {
    if (original === undefined) delete process.env.DODODO_SOURCE_CONFIG;
    else process.env.DODODO_SOURCE_CONFIG = original;
    await rm(directory, { recursive: true, force: true });
  }
}

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

test("handleTaskSetReminderOffset은 잘못된 id 또는 offsetMinutes를 거절한다", async () => {
  const { container, taskId } = await seededContainer();

  assertValidationFailure(await handleTaskSetReminderOffset(container, { id: "", offsetMinutes: 60 }));
  assertValidationFailure(await handleTaskSetReminderOffset(container, { id: taskId, offsetMinutes: -1 }));
  assertValidationFailure(await handleTaskSetReminderOffset(container, { id: taskId, offsetMinutes: 1.5 }));
  assertValidationFailure(await handleTaskSetReminderOffset(container, { id: taskId, offsetMinutes: "60" }));
  assertValidationFailure(await handleTaskSetReminderOffset(container, { id: taskId }));

  const ok = await handleTaskSetReminderOffset(container, { id: taskId, offsetMinutes: 60 });
  assert.equal(ok.ok, true);
});

test("handleSourceRegister/handleSourceRemove는 잘못된 payload를 모두 거절한다", async () => {
  await withTempSourceConfig(async () => {
    assertValidationFailure(await handleSourceRegister(undefined));
    assertValidationFailure(await handleSourceRegister(null));
    assertValidationFailure(await handleSourceRegister({}));
    assertValidationFailure(await handleSourceRegister({ type: "file", value: "x" })); // 지원 안 하는 타입
    assertValidationFailure(await handleSourceRegister({ type: "school-site", value: 123 }));

    assertValidationFailure(await handleSourceRemove(undefined));
    assertValidationFailure(await handleSourceRemove({}));
    assertValidationFailure(await handleSourceRemove({ id: "file" }));

    const ok = await handleSourceRegister({ type: "school-site", value: "https://school.example" });
    assert.equal(ok.ok, true);
  });
});
