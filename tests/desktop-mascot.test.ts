import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
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

test("desktop mascot Renderer는 실제 IPC 상세 액션과 일정 추가 화면을 제공한다", async () => {
  const [html, renderer, adapter] = await Promise.all([
    readFile("apps/desktop/src/renderer/character/index.html", "utf8"),
    readFile("apps/desktop/src/renderer/character/mascot.js", "utf8"),
    readFile("apps/desktop/src/renderer/character/desktop-api.mjs", "utf8"),
  ]);

  assert.match(html, /data-view="add"/);
  assert.match(renderer, /desktopApi\.detail/);
  assert.match(renderer, /desktopApi\.complete/);
  assert.match(renderer, /desktopApi\.snooze/);
  assert.match(renderer, /desktopApi\.add/);
  assert.doesNotMatch(adapter, /mock-task|mock-opportunity/);
});
