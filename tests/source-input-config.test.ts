import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadSourceInputConfig, resolveSourceInputConfigPath } from "../apps/cli/src/runtime/sourceInputConfig.ts";

test("loadSourceInputConfig는 설정 파일이 없으면 undefined를 반환한다(Fixture 폴백)", () => {
  const cwd = join(tmpdir(), "dododo-no-such-config-dir");
  const loaded = loadSourceInputConfig({}, cwd);
  assert.equal(loaded, undefined);
});

test("resolveSourceInputConfigPath는 DODODO_SOURCES_CONFIG_PATH 미설정이면 기본 파일명을 cwd 기준으로 쓴다", () => {
  const path = resolveSourceInputConfigPath({}, "/repo");
  assert.match(path, /dododo\.sources\.json$/);
});

test("loadSourceInputConfig는 유효한 JSON 설정 파일을 파싱한다", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dododo-sources-config-"));
  try {
    const configPath = join(directory, "dododo.sources.json");
    await writeFile(configPath, JSON.stringify({
      schoolEmail: {
        inputDirectory: "./mail",
        allowedSenderDomains: ["school.example"],
      },
    }));

    const loaded = loadSourceInputConfig({ DODODO_SOURCES_CONFIG_PATH: configPath }, directory);
    assert.equal(loaded?.path, configPath);
    assert.deepEqual(loaded?.config.schoolEmail?.allowedSenderDomains, ["school.example"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("loadSourceInputConfig는 잘못된 JSON이면 경로를 포함한 오류를 던진다", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dododo-sources-config-"));
  try {
    const configPath = join(directory, "dododo.sources.json");
    await writeFile(configPath, "{ not json");

    try {
      loadSourceInputConfig({ DODODO_SOURCES_CONFIG_PATH: configPath }, directory);
      assert.fail("should have thrown");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      assert.match(message, /올바른 JSON이 아닙니다/);
      assert.ok(message.includes(configPath), "오류 메시지에 파일 경로가 포함돼야 함");
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("loadSourceInputConfig는 최상위가 배열이면 거부한다", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dododo-sources-config-"));
  try {
    const configPath = join(directory, "dododo.sources.json");
    await writeFile(configPath, "[]");

    assert.throws(
      () => loadSourceInputConfig({ DODODO_SOURCES_CONFIG_PATH: configPath }, directory),
      /객체여야 합니다/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
