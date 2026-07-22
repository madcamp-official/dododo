import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import test from "node:test";

const desktopFiles = [
  "apps/desktop/src/main/windows/settingsWindow.mjs",
];

test("desktop 설정 창 JavaScript 진입점은 구문 검사를 통과한다", () => {
  for (const path of desktopFiles) {
    const result = spawnSync(process.execPath, ["--check", path], { encoding: "utf8" });
    assert.equal(result.status, 0, `${path}: ${result.stderr}`);
  }
});

test("설정 창은 전용 Renderer 경로를 로드하고 기존 preload를 재사용한다", async () => {
  const settingsWindow = await readFile("apps/desktop/src/main/windows/settingsWindow.mjs", "utf8");

  assert.match(settingsWindow, /createSettingsWindowCoordinator/);
  assert.match(settingsWindow, /buildSettingsWindowOptions\(preloadPath\)/);
  assert.match(settingsWindow, /window\.loadFile\(rendererPath\)/);
});

test("index.mjs는 설정 Renderer 경로를 settingsWindow에 넘기고 발신 창을 검증한다", async () => {
  const main = await readFile("apps/desktop/src/main/index.mjs", "utf8");

  assert.match(main, /renderer\/settings\/index\.html/);
  assert.match(main, /createOpenSettings\(\{ preloadPath, rendererPath: settingsRendererPath \}\)/);
  assert.match(main, /ipcMain\.on\(OPEN_SETTINGS, \(event\) => \{/);
  assert.match(main, /BrowserWindow\.fromWebContents\(event\.sender\)/);
  assert.match(main, /characterWindows\.has\(senderWindow\)/);
});

test("preload는 desktopWindow.openSettings로 desktop:open-settings만 send한다", async () => {
  const preload = await readFile("apps/desktop/src/preload/index.cjs", "utf8");

  assert.match(preload, /desktopWindow/);
  assert.match(preload, /openSettings\(\)\s*\{\s*ipcRenderer\.send\(OPEN_SETTINGS\);/);
  assert.match(preload, /OPEN_SETTINGS = "desktop:open-settings"/);
});
