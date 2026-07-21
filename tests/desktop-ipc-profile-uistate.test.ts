import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { getProfile, saveProfile } from "../apps/desktop/src/main/ipc/profile.ts";
import { getUiState, setUiState } from "../apps/desktop/src/main/ipc/uiState.ts";
import { createCliContainer } from "../apps/cli/src/runtime/container.ts";

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
