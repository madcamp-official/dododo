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

test("desktop mascot의 mouse passthrough 초기 상태는 Renderer가 단독으로 설정한다", async () => {
  const [main, preload, renderer, style] = await Promise.all([
    readFile("apps/desktop/src/main/index.mjs", "utf8"),
    readFile("apps/desktop/src/preload/index.cjs", "utf8"),
    readFile("apps/desktop/src/renderer/character/mascot.js", "utf8"),
    readFile("apps/desktop/src/renderer/character/style.css", "utf8"),
  ]);

  assert.doesNotMatch(main, /setIgnoreMouseEvents\(true/);
  assert.match(renderer, /setMousePassthrough\(isIgnoringMouse\)/);
  assert.match(renderer, /startCharacterDrag/);
  assert.match(renderer, /setPointerCapture/);
  assert.match(preload, /desktop:start-character-drag/);
  assert.match(main, /characterWindow\.setPosition/);
  assert.match(style, /-webkit-app-region: no-drag/);
});

test("desktop mascot 팝업 메뉴는 창 위쪽 경계 안에 배치된다", async () => {
  const [main, style] = await Promise.all([
    readFile("apps/desktop/src/main/index.mjs", "utf8"),
    readFile("apps/desktop/src/renderer/character/style.css", "utf8"),
  ]);

  assert.match(style, /\.popup-menu\s*\{[^}]*top:\s*12px;[^}]*bottom:\s*auto;/s);
  assert.match(style, /\.popup-menu\s*\{[^}]*box-sizing:\s*border-box;[^}]*overflow:\s*hidden;/s);
  assert.match(main, /screen\.getDisplayNearestPoint\(pointer\)\.workArea/);
});

test("desktop mascot은 메뉴와 패널보다 위에 표시된다", async () => {
  const style = await readFile("apps/desktop/src/renderer/character/style.css", "utf8");

  assert.match(style, /\.character-button\s*\{[^}]*z-index:\s*10;/s);
  assert.match(style, /\.popup-menu,\s*\.panel\s*\{[^}]*z-index:\s*4;/s);
});

test("desktop mascot은 확장된 메뉴와 패널 영역에 겹치지 않는다", async () => {
  const [main, preload, renderer, style] = await Promise.all([
    readFile("apps/desktop/src/main/index.mjs", "utf8"),
    readFile("apps/desktop/src/preload/index.cjs", "utf8"),
    readFile("apps/desktop/src/renderer/character/mascot.js", "utf8"),
    readFile("apps/desktop/src/renderer/character/style.css", "utf8"),
  ]);

  assert.match(main, /EXPANDED_SIZE = \{ width: 680, height: 420 \}/);
  assert.match(main, /width: EXPANDED_SIZE\.width/);
  assert.doesNotMatch(preload, /desktop:set-surface-expanded/);
  assert.doesNotMatch(renderer, /setSurfaceExpanded/);
  assert.match(style, /\.popup-menu\s*\{[^}]*right:\s*200px;/s);
  assert.match(style, /\.panel\s*\{[^}]*inset:\s*8px 200px 8px 8px;/s);
  assert.doesNotMatch(main, /characterWindow\.setBounds/);
});

test("desktop mascot 상세 버튼 오류 처리는 정의되지 않은 상태를 참조하지 않는다", async () => {
  const renderer = await readFile("apps/desktop/src/renderer/character/mascot.js", "utf8");
  const openDetail = renderer.match(/async function openDetail[\s\S]*?\n\}/)?.[0] ?? "";

  assert.doesNotMatch(openDetail, /throwOnError/);
  assert.match(openDetail, /renderError\(error\)/);
});

test("desktop mascot Renderer는 실제 IPC 상세 액션과 일정 추가 화면을 제공한다", async () => {
  const [html, renderer, adapter, style] = await Promise.all([
    readFile("apps/desktop/src/renderer/character/index.html", "utf8"),
    readFile("apps/desktop/src/renderer/character/mascot.js", "utf8"),
    readFile("apps/desktop/src/renderer/character/desktop-api.mjs", "utf8"),
    readFile("apps/desktop/src/renderer/character/style.css", "utf8"),
  ]);

  assert.match(html, /data-view="add"/);
  assert.match(renderer, /desktopApi\.detail/);
  assert.match(renderer, /desktopApi\.complete/);
  assert.match(renderer, /desktopApi\.snooze/);
  assert.match(renderer, /desktopApi\.add/);
  assert.match(renderer, /closest\("\.action-row"\).*querySelectorAll\("button"\)/);
  assert.match(renderer, /createExclusiveActionRunner/);
  assert.match(renderer, /처리는 완료됐지만 목록 갱신에 실패했습니다/);
  assert.match(style, /\.answer\s*\{[^}]*white-space:\s*pre-line;/s);
  assert.doesNotMatch(adapter, /mock-task|mock-opportunity/);
});
