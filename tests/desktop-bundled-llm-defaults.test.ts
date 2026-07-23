import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  loadBundledLlmDefaults,
  mergeLlmEnvDefaults,
} from "../apps/desktop/src/main/llm/bundledLlmDefaults.ts";

async function withAppRoot(
  write: (resourcesDir: string) => Promise<void>,
  fn: (appRoot: string) => Promise<void>,
): Promise<void> {
  const appRoot = await mkdtemp(join(tmpdir(), "dododo-bundled-llm-"));
  const resourcesDir = join(appRoot, "apps/desktop/resources");
  await mkdir(resourcesDir, { recursive: true });
  try {
    await write(resourcesDir);
    await fn(appRoot);
  } finally {
    await rm(appRoot, { recursive: true, force: true });
  }
}

test("loadBundledLlmDefaults는 파일이 없으면 빈 객체를 반환한다", async () => {
  await withAppRoot(
    async () => {},
    async (appRoot) => {
      assert.deepEqual(loadBundledLlmDefaults(appRoot), {});
    },
  );
});

test("loadBundledLlmDefaults는 유효한 파일을 DODODO_LLM_* 환경변수로 매핑한다", async () => {
  await withAppRoot(
    async (resourcesDir) => {
      await writeFile(
        join(resourcesDir, "bundled-llm-default.json"),
        JSON.stringify({
          provider: "remote-job",
          baseUrl: "https://llm.madcamp-kaist.org",
          token: "dodo_device_token",
          timeoutMs: 1_200_000,
        }),
        "utf8",
      );
    },
    async (appRoot) => {
      assert.deepEqual(loadBundledLlmDefaults(appRoot), {
        DODODO_LLM_PROVIDER: "remote-job",
        DODODO_LLM_BASE_URL: "https://llm.madcamp-kaist.org",
        DODODO_LLM_TOKEN: "dodo_device_token",
        DODODO_LLM_TIMEOUT_MS: "1200000",
      });
    },
  );
});

test("loadBundledLlmDefaults는 손상된 JSON에도 throw하지 않고 빈 객체를 반환한다", async () => {
  await withAppRoot(
    async (resourcesDir) => {
      await writeFile(join(resourcesDir, "bundled-llm-default.json"), "{ 이건 JSON이 아님", "utf8");
    },
    async (appRoot) => {
      assert.deepEqual(loadBundledLlmDefaults(appRoot), {});
    },
  );
});

test("loadBundledLlmDefaults는 object가 아닌 JSON(배열 등)도 빈 객체로 취급한다", async () => {
  await withAppRoot(
    async (resourcesDir) => {
      await writeFile(join(resourcesDir, "bundled-llm-default.json"), "[1, 2, 3]", "utf8");
    },
    async (appRoot) => {
      assert.deepEqual(loadBundledLlmDefaults(appRoot), {});
    },
  );
});

test("mergeLlmEnvDefaults는 이미 설정된 값을 덮어쓰지 않는다", () => {
  const env = { DODODO_LLM_BASE_URL: "http://localhost:11434", DODODO_LLM_PROVIDER: "ollama" };
  const merged = mergeLlmEnvDefaults(env, {
    DODODO_LLM_BASE_URL: "https://llm.madcamp-kaist.org",
    DODODO_LLM_PROVIDER: "remote-job",
    DODODO_LLM_TOKEN: "dodo_device_token",
  });
  assert.equal(merged.DODODO_LLM_BASE_URL, "http://localhost:11434");
  assert.equal(merged.DODODO_LLM_PROVIDER, "ollama");
  assert.equal(merged.DODODO_LLM_TOKEN, "dodo_device_token");
});

test("mergeLlmEnvDefaults는 빈 값을 실제 값으로 채운다", () => {
  const merged = mergeLlmEnvDefaults(
    {},
    {
      DODODO_LLM_PROVIDER: "remote-job",
      DODODO_LLM_BASE_URL: "https://llm.madcamp-kaist.org",
      DODODO_LLM_TOKEN: "dodo_device_token",
      DODODO_LLM_TIMEOUT_MS: "1200000",
    },
  );
  assert.equal(merged.DODODO_LLM_PROVIDER, "remote-job");
  assert.equal(merged.DODODO_LLM_BASE_URL, "https://llm.madcamp-kaist.org");
  assert.equal(merged.DODODO_LLM_TOKEN, "dodo_device_token");
  assert.equal(merged.DODODO_LLM_TIMEOUT_MS, "1200000");
});

test("mergeLlmEnvDefaults는 defaults가 비어 있으면 기존 env를 그대로 유지한다", () => {
  const env = { DODODO_DB_PATH: "./data/context.db" };
  const merged = mergeLlmEnvDefaults(env, {});
  assert.deepEqual(merged, env);
});
