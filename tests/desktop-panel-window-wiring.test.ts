import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import test from "node:test";

const desktopFiles = [
  "apps/desktop/src/main/windows/panelWindow.mjs",
];

test("desktop 패널 창 JavaScript 진입점은 구문 검사를 통과한다", () => {
  for (const path of desktopFiles) {
    const result = spawnSync(process.execPath, ["--check", path], { encoding: "utf8" });
    assert.equal(result.status, 0, `${path}: ${result.stderr}`);
  }
});

test("패널 창은 전용 Renderer 경로를 로드하고 배치 계산·coordinator를 재사용한다", async () => {
  const panelWindow = await readFile("apps/desktop/src/main/windows/panelWindow.mjs", "utf8");

  assert.match(panelWindow, /createPanelWindowCoordinator/);
  assert.match(panelWindow, /layoutPanelWindow\(layout\.characterPlacement/);
  assert.match(panelWindow, /window\.loadFile\(rendererPath\)/);
  assert.match(panelWindow, /did-finish-load/);
});

test("index.mjs는 발신 창을 검증하고 payload를 parsePanelRoute로 거른 뒤 배치를 계산한다", async () => {
  const main = await readFile("apps/desktop/src/main/index.mjs", "utf8");

  assert.match(main, /renderer\/panels\/index\.html/);
  assert.match(main, /ipcMain\.on\(OPEN_PANEL, \(event, payload\) => \{/);
  assert.match(main, /characterWindows\.has\(senderWindow\)/);
  assert.match(main, /parsePanelRoute\(payload\)/);
  assert.match(main, /screen\.getDisplayMatching\(senderWindow\.getBounds\(\)\)\.workArea/);
});

test("preload는 desktopWindow.openPanel/onPanelNavigate로 패널 창과 통신한다", async () => {
  const preload = await readFile("apps/desktop/src/preload/index.cjs", "utf8");

  assert.match(preload, /OPEN_PANEL = "desktop:open-panel"/);
  assert.match(preload, /PANEL_NAVIGATE = "panel:navigate"/);
  assert.match(preload, /openPanel\(route\)\s*\{\s*ipcRenderer\.send\(OPEN_PANEL, route\);/);
  assert.match(preload, /onPanelNavigate\(callback\)/);
});
