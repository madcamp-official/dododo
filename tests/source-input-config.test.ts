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

test("resolveSourceInputConfigPath는 DODODO_SOURCE_CONFIG 미설정이면 기본 파일명을 cwd 기준으로 쓴다", () => {
  const resolved = resolveSourceInputConfigPath({}, "/repo");
  assert.match(resolved.path, /dododo\.sources\.json$/);
  assert.equal(resolved.isExplicit, false);
});

test("resolveSourceInputConfigPath는 DODODO_SOURCE_CONFIG가 설정되면 isExplicit을 true로 표시한다", () => {
  const resolved = resolveSourceInputConfigPath({ DODODO_SOURCE_CONFIG: "./custom.json" }, "/repo");
  assert.equal(resolved.isExplicit, true);
});

test("loadSourceInputConfig는 명시한 경로의 파일이 없으면 조용히 폴백하지 않고 Error를 던진다(doyeonid, PR #40 리뷰)", () => {
  const cwd = join(tmpdir(), "dododo-no-such-config-dir");
  assert.throws(
    () => loadSourceInputConfig({ DODODO_SOURCE_CONFIG: "./missing.dododo.sources.json" }, cwd),
    /찾을 수 없습니다/,
  );
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

    const loaded = loadSourceInputConfig({ DODODO_SOURCE_CONFIG: configPath }, directory);
    assert.equal(loaded?.path, configPath);
    assert.deepEqual(loaded?.config.schoolEmail?.allowedSenderDomains, ["school.example"]);
    assert.equal(loaded?.config.schoolEmail?.inputDirectory, join(directory, "mail"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("loadSourceInputConfig는 상대경로를 실행 cwd가 아니라 설정 파일 디렉터리 기준으로 푼다", async () => {
  const configDirectory = await mkdtemp(join(tmpdir(), "dododo-sources-config-"));
  const unrelatedCwd = await mkdtemp(join(tmpdir(), "dododo-unrelated-cwd-"));
  try {
    const configPath = join(configDirectory, "dododo.sources.json");
    await writeFile(configPath, JSON.stringify({
      schoolEmail: { inputDirectory: "./mail", allowedSenderDomains: ["school.example"] },
      lms: {
        baseUrl: "https://lms.example",
        inputPaths: ["./html/a.html", "./html/b.html"],
        selectors: { item: ".item", title: ".title" },
      },
    }));

    // DODODO_SOURCE_CONFIG는 절대경로로 주지만 실행 cwd는 설정 파일과 무관한
    // 디렉터리다 — cwd 기준으로 풀리면 실제 존재하지 않는 경로를 가리키게 된다
    // (PR #40 리뷰, 김도현 — 설정 파일을 다른 디렉터리에서 실행하면 대상이 달라지는 문제).
    const loaded = loadSourceInputConfig({ DODODO_SOURCE_CONFIG: configPath }, unrelatedCwd);
    assert.equal(loaded?.config.schoolEmail?.inputDirectory, join(configDirectory, "mail"));
    assert.deepEqual(loaded?.config.lms?.inputPaths, [
      join(configDirectory, "html", "a.html"),
      join(configDirectory, "html", "b.html"),
    ]);
  } finally {
    await rm(configDirectory, { recursive: true, force: true });
    await rm(unrelatedCwd, { recursive: true, force: true });
  }
});

test("loadSourceInputConfig는 잘못된 JSON이면 경로를 포함한 오류를 던진다", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dododo-sources-config-"));
  try {
    const configPath = join(directory, "dododo.sources.json");
    await writeFile(configPath, "{ not json");

    try {
      loadSourceInputConfig({ DODODO_SOURCE_CONFIG: configPath }, directory);
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

// v0.1.2 이전에는 schoolSite가 배열이 아니라 단일 객체였다. 그 시절 만든
// dododo.sources.json을 그대로 쓰는 사용자가 업그레이드 후에도 에러 없이 계속
// 동작해야 한다(normalizeSourceInputConfig가 읽는 시점에 배열로 감싼다).
test("loadSourceInputConfig는 예전 형식(단일 객체) schoolSite를 배열로 자동 변환한다", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dododo-sources-config-"));
  try {
    const configPath = join(directory, "dododo.sources.json");
    await writeFile(configPath, JSON.stringify({
      schoolSite: { url: "https://school.example/notices" },
    }));

    const loaded = loadSourceInputConfig({ DODODO_SOURCE_CONFIG: configPath }, directory);
    assert.deepEqual(loaded?.config.schoolSite, [{ url: "https://school.example/notices" }]);
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
      () => loadSourceInputConfig({ DODODO_SOURCE_CONFIG: configPath }, directory),
      /객체여야 합니다/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
