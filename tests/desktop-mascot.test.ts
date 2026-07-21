import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import test from "node:test";

const desktopFiles = [
  "apps/desktop/src/main/index.mjs",
  "apps/desktop/src/preload/index.cjs",
  "apps/desktop/src/renderer/character/mascot.js",
];

test("desktop mascot JavaScript 진입점은 모두 구문 검사를 통과한다", () => {
  for (const path of desktopFiles) {
    const result = spawnSync(process.execPath, ["--check", path], { encoding: "utf8" });
    assert.equal(result.status, 0, `${path}: ${result.stderr}`);
  }
});

test("desktop mascot Renderer가 기본 idle 에셋과 preload를 함께 배포한다", async () => {
  await Promise.all([
    access("apps/desktop/src/renderer/character/index.html"),
    access("apps/desktop/resources/character/idle.png"),
    access("apps/desktop/src/preload/index.cjs"),
  ]);
});
