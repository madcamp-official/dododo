import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createCliContainer } from "../apps/cli/src/runtime/container.ts";
import { runSync } from "../apps/cli/src/commands/sync.ts";
import { askQuestion } from "../apps/desktop/src/main/ipc/ask.ts";
import { getCalendarWeek } from "../apps/desktop/src/main/ipc/calendar.ts";
import { getInbox } from "../apps/desktop/src/main/ipc/inbox.ts";
import { getProfile, saveProfile } from "../apps/desktop/src/main/ipc/profile.ts";
import { runSyncIpc } from "../apps/desktop/src/main/ipc/sync.ts";
import { getToday } from "../apps/desktop/src/main/ipc/today.ts";
import { getUiState, setUiState } from "../apps/desktop/src/main/ipc/uiState.ts";

// apps/desktop/src/main/ipc의 로직 함수들(register.ts 제외)은 electron을 import하지
// 않으므로 CLI와 마찬가지로 node --test로 바로 검증할 수 있다 — Electron 프로세스나
// 디스플레이가 전혀 필요 없다.

test("today:get은 sync 전에는 빈 entries를 반환한다", async () => {
  const container = createCliContainer({ databasePath: ":memory:" });
  const result = await getToday(container);
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.data.entries, []);
});

test("today:get은 sync 후 CLI today와 같은 항목을 구조화된 형태로 반환한다", async () => {
  const container = createCliContainer({ databasePath: ":memory:" });
  await runSync(container);

  const result = await getToday(container);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.data.entries.length >= 1);
  const first = result.data.entries[0];
  assert.ok(first !== undefined);
  assert.ok(typeof first.item.title === "string");
  assert.ok(typeof first.recommendation.reason === "string");
  assert.ok(typeof first.recommendation.score === "number");
});

test("inbox:get은 sync 후 Opportunity를 관련도 순으로 반환한다", async () => {
  const container = createCliContainer({ databasePath: ":memory:" });
  await runSync(container);

  const result = await getInbox(container);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.data.entries.length >= 1);
  assert.ok(result.data.entries.every((entry) => entry.item.kind === "opportunity"));
});

test("calendar:get은 이번 주 범위 밖 일정을 제외한다", async () => {
  const container = createCliContainer({ databasePath: ":memory:" });
  await runSync(container);

  const now = new Date("2026-07-21T09:00:00+09:00");
  const result = await getCalendarWeek(container, now);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  for (const entry of result.data.entries) {
    const at = new Date(entry.at).getTime();
    assert.ok(at >= new Date("2026-07-20T00:00:00+09:00").getTime());
    assert.ok(at < new Date("2026-07-27T00:00:00+09:00").getTime());
  }
});

test("ask:ask는 빈 질문을 validation 에러로 거부한다", async () => {
  const container = createCliContainer({ databasePath: ":memory:" });
  const result = await askQuestion(container, { question: "   " });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "validation");
});

test("ask:ask는 sync 후 근거 있는 답변을 반환한다", async () => {
  const container = createCliContainer({ databasePath: ":memory:" });
  await runSync(container);

  const result = await askQuestion(container, { question: "오늘 할 일이 뭐야" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(typeof result.data.answer === "string" && result.data.answer.length > 0);
});

test("sync:run은 Source별 결과와 합계를 함께 반환한다", async () => {
  const container = createCliContainer({ databasePath: ":memory:" });
  const result = await runSyncIpc(container);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.sourcesConfigError, undefined);
  assert.deepEqual(result.data.sources.map((source) => source.sourceId).sort(), [
    "lms-main",
    "school-email-main",
    "school-site-main",
  ]);
  assert.equal(
    result.data.collected,
    result.data.sources.reduce((sum, source) => sum + source.collected, 0),
  );
});

test("profile:get/save는 그대로 왕복한다", async () => {
  const container = createCliContainer({ databasePath: ":memory:" });
  const empty = await getProfile(container);
  assert.equal(empty.ok, true);
  if (empty.ok) assert.equal(empty.data, undefined);

  const profile = {
    school: "테스트대", major: "컴퓨터공학", year: "3",
    interests: ["AI"], activityTypes: ["해커톤"], preferredLocations: [],
    explicitConstraints: [],
  };
  const saveResult = await saveProfile(container, profile);
  assert.equal(saveResult.ok, true);

  const fetched = await getProfile(container);
  assert.equal(fetched.ok, true);
  if (fetched.ok) assert.deepEqual(fetched.data, profile);
});

test("ui-state get/set은 파일에 값을 보존하고 다른 키는 건드리지 않는다", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dododo-ui-state-"));
  const filePath = join(dir, "ui-state.json");
  try {
    const missing = await getUiState(filePath, "lastGreetingDate");
    assert.equal(missing.ok, true);
    if (missing.ok) assert.equal(missing.data, undefined);

    await setUiState(filePath, "lastGreetingDate", "2026-07-21");
    await setUiState(filePath, "otherKey", 42);

    const fetched = await getUiState(filePath, "lastGreetingDate");
    assert.equal(fetched.ok, true);
    if (fetched.ok) assert.equal(fetched.data, "2026-07-21");

    const other = await getUiState(filePath, "otherKey");
    assert.equal(other.ok, true);
    if (other.ok) assert.equal(other.data, 42);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
