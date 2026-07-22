import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createCliContainer } from "../apps/cli/src/runtime/container.ts";
import { registerSource, removeSource } from "../apps/desktop/src/main/ipc/source.ts";

// docs/frontend-plan.md 2.3, apps/cli/src/runtime/sourceRegistration.ts: 등록·제거는
// dododo.sources.json만 쓰고 실행 중인 CliContainer의 collectors는 시작 시 한 번만
// 구성되므로 재시작 후에야 반영된다("restartRequired: true"의 근거). desktop-source.test.ts는
// 설정 파일 쓰기·읽기 계약만 확인하고, 이 재시작 반영 자체는 아직 검증된 적이 없었다 —
// registerSource/removeSource 이후 새 createCliContainer 인스턴스(재시작 시뮬레이션)를
// 만들어 collectors가 실제로 바뀌는지 확인한다.
async function withTempSourceConfig(fn: () => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "dododo-desktop-source-restart-"));
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

test("school-site 등록은 이미 떠 있는 container가 아니라 다음 container(재시작)에서 반영된다", async () => {
  await withTempSourceConfig(async () => {
    const beforeRestart = createCliContainer({ databasePath: ":memory:" });
    try {
      assert.deepEqual(beforeRestart.collectors.map((collector) => collector.sourceType), []);

      const registerResult = await registerSource({ type: "school-site", value: "https://school.example" });
      assert.equal(registerResult.ok, true);
      if (!registerResult.ok) return;
      assert.equal(registerResult.data.restartRequired, true);

      // 등록 직후에도 이미 만들어진 container에는 반영되지 않는다 — collectors는
      // createCliContainer 호출 시점에만 구성되기 때문이다.
      assert.deepEqual(beforeRestart.collectors.map((collector) => collector.sourceType), []);

      const afterRestart = createCliContainer({ databasePath: ":memory:" });
      try {
        assert.deepEqual(afterRestart.collectors.map((collector) => collector.sourceType), ["school-site"]);
        assert.equal(afterRestart.sourcesConfigPath, process.env.DODODO_SOURCE_CONFIG);
        assert.equal(afterRestart.sourcesConfigPathIsExplicit, true);
        assert.equal(afterRestart.sourcesConfigError, undefined);
      } finally {
        afterRestart.close();
      }
    } finally {
      beforeRestart.close();
    }
  });
});

test("school-site 제거도 다음 container(재시작)에서만 반영된다", async () => {
  await withTempSourceConfig(async () => {
    const registerResult = await registerSource({ type: "school-site", value: "https://school.example" });
    assert.equal(registerResult.ok, true);

    const withSource = createCliContainer({ databasePath: ":memory:" });
    try {
      assert.deepEqual(withSource.collectors.map((collector) => collector.sourceType), ["school-site"]);

      const removeResult = await removeSource("school-site");
      assert.equal(removeResult.ok, true);
      if (!removeResult.ok) return;
      assert.equal(removeResult.data.restartRequired, true);

      // 제거 직후에도 이미 만들어진 container는 그대로다 — collectors는
      // createCliContainer 호출 시점에만 구성되기 때문이다(등록 테스트와 대칭).
      assert.deepEqual(withSource.collectors.map((collector) => collector.sourceType), ["school-site"]);

      const afterRemove = createCliContainer({ databasePath: ":memory:" });
      try {
        assert.deepEqual(afterRemove.collectors.map((collector) => collector.sourceType), []);
      } finally {
        afterRemove.close();
      }
    } finally {
      withSource.close();
    }
  });
});
