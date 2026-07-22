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
  assert.match(panelWindow, /layoutPanelWindow\(layout\.characterBounds/);
  assert.match(panelWindow, /coordinator\.open\(route, position, PANEL_SIZE/);
  assert.match(panelWindow, /window\.setBounds/);
  assert.match(panelWindow, /window\.loadFile\(rendererPath\)/);
  assert.match(panelWindow, /did-finish-load/);
});

// doyeonid 리뷰(PR #97) P1: 로드 전 navigate가 겹치면 stale한 초기 route가 나가던
// 문제. navigate()가 routeGate를 거치지 않고 다시 곧장 send하는 회귀를 막는다.
test("패널 창은 로드 전 navigate를 routeGate로 감싸 stale route를 보내지 않는다", async () => {
  const panelWindow = await readFile("apps/desktop/src/main/windows/panelWindow.mjs", "utf8");

  assert.match(panelWindow, /createPanelWindowRouteGate\(initialRoute\)/);
  assert.match(panelWindow, /routeGate\.markReady\(\)/);
  assert.match(panelWindow, /routeGate\.setRoute\(nextRoute\)/);
  assert.doesNotMatch(panelWindow, /navigate: \(nextRoute\) => window\.webContents\.send/);
});

test("index.mjs는 발신 창을 검증하고 payload를 parsePanelRoute로 거른 뒤 배치를 계산한다", async () => {
  const main = await readFile("apps/desktop/src/main/index.mjs", "utf8");

  assert.match(main, /renderer\/panels\/index\.html/);
  assert.match(main, /ipcMain\.on\(OPEN_PANEL, \(event, payload\) => \{/);
  assert.match(main, /characterWindows\.has\(senderWindow\)/);
  assert.match(main, /parsePanelRoute\(payload\)/);
  assert.match(main, /screen\.getDisplayMatching\(windowBounds\)\.workArea/);
  assert.match(main, /openPanel\(route, \{ characterBounds, workArea \}\)/);
});

test("preload는 desktopWindow.openPanel/onPanelNavigate로 패널 창과 통신한다", async () => {
  const preload = await readFile("apps/desktop/src/preload/index.cjs", "utf8");

  assert.match(preload, /OPEN_PANEL = "desktop:open-panel"/);
  assert.match(preload, /PANEL_NAVIGATE = "panel:navigate"/);
  assert.match(preload, /openPanel\(route\)\s*\{\s*ipcRenderer\.send\(OPEN_PANEL, route\);/);
  assert.match(preload, /onPanelNavigate\(callback\)/);
});
