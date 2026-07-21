import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { listSources, registerSource, removeSource } from "../apps/desktop/src/main/ipc/source.ts";

// doyeonid 리뷰(PR #67) 1번 반영 후, DODODO_SOURCE_CONFIG로 명시한 경로에 파일이
// 없으면 sourceRegistration.ts가 에러를 던진다 — 테스트 격리를 위해 명시 경로를 쓰되
// 빈 설정 파일을 미리 만들어 둔다(tests/source-registration.test.ts와 같은 패턴).
async function withTempSourceConfig(fn: () => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "dododo-desktop-source-"));
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

test("registerSource는 school-site를 등록하고 restartRequired를 알린다", async () => {
  await withTempSourceConfig(async () => {
    const result = await registerSource({ type: "school-site", value: "https://school.example" });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.data.restartRequired, true);

    const listed = await listSources();
    assert.equal(listed.ok, true);
    if (!listed.ok) return;
    assert.deepEqual(listed.data.sources, [{ id: "school-site", value: "https://school.example" }]);
  });
});

test("registerSource는 school-email/lms를 아직 지원하지 않는다고 알린다", async () => {
  await withTempSourceConfig(async () => {
    const email = await registerSource({ type: "school-email", value: "./mail" });
    assert.equal(email.ok, false);
    if (email.ok) return;
    assert.equal(email.error.code, "not-supported");

    const lms = await registerSource({ type: "lms", value: "https://lms.example" });
    assert.equal(lms.ok, false);
  });
});

test("registerSource는 빈 값을 거절한다", async () => {
  await withTempSourceConfig(async () => {
    const result = await registerSource({ type: "school-site", value: "   " });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error.code, "validation");
  });
});

// 김도현 리뷰(PR #67): URL 형식 오류가 toResult() 안에서 던져지면 "unknown"으로
// 뭉개졌다 — code가 정확히 "validation"으로 나가는지 확인한다(result.ts 관례).
test("registerSource는 유효하지 않은 URL을 validation 코드로 거절한다", async () => {
  await withTempSourceConfig(async () => {
    const notAUrl = await registerSource({ type: "school-site", value: "not-a-url" });
    assert.equal(notAUrl.ok, false);
    if (notAUrl.ok) return;
    assert.equal(notAUrl.error.code, "validation");

    const wrongProtocol = await registerSource({ type: "school-site", value: "ftp://school.example" });
    assert.equal(wrongProtocol.ok, false);
    if (wrongProtocol.ok) return;
    assert.equal(wrongProtocol.error.code, "validation");
  });
});

test("removeSource는 등록된 항목을 지운다", async () => {
  await withTempSourceConfig(async () => {
    await registerSource({ type: "school-site", value: "https://school.example" });

    const result = await removeSource("school-site");
    assert.equal(result.ok, true);

    const listed = await listSources();
    assert.equal(listed.ok, true);
    if (!listed.ok) return;
    assert.deepEqual(listed.data.sources, []);
  });
});

test("removeSource는 등록되지 않은 항목이면 not-found를 반환한다", async () => {
  await withTempSourceConfig(async () => {
    const result = await removeSource("lms");
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error.code, "not-found");
  });
});
