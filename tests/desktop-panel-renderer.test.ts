import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import test from "node:test";

const htmlPath = "apps/desktop/src/renderer/panels/index.html";
const scriptPath = "apps/desktop/src/renderer/panels/panel.js";
const stylePath = "apps/desktop/src/renderer/panels/style.css";

test("독립 결과 패널 Renderer가 배포되고 구문 검사를 통과한다", async () => {
  await Promise.all([access(htmlPath), access(scriptPath), access(stylePath)]);
  const result = spawnSync(process.execPath, ["--check", scriptPath], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});

test("독립 결과 패널은 다섯 route와 기존 desktopApi를 연결한다", async () => {
  const [html, script] = await Promise.all([readFile(htmlPath, "utf8"), readFile(scriptPath, "utf8")]);
  assert.match(html, /data-panel-title/);
  assert.match(html, /data-panel-content/);
  assert.match(script, /onPanelNavigate/);
  for (const view of ["today", "calendar", "inbox", "ask", "detail"]) {
    assert.match(script, new RegExp(`"${view}"`));
  }
  assert.match(script, /desktopApi\.today/);
  assert.match(script, /desktopApi\.calendar/);
  assert.match(script, /desktopApi\.inbox/);
  assert.match(script, /desktopApi\.ask/);
  assert.match(script, /desktopApi\.detail/);
  assert.match(script, /version === navigationVersion/);
});

test("물어보기 성공 답변은 패널에 중복 표시하지 않고 질문 창을 유지한다", async () => {
  const [panelScript, mascotScript] = await Promise.all([
    readFile(scriptPath, "utf8"),
    readFile("apps/desktop/src/renderer/character/mascot.js", "utf8"),
  ]);

  assert.doesNotMatch(panelScript, /data-answer/);
  assert.doesNotMatch(mascotScript, /data-answer/);
  assert.doesNotMatch(panelScript, /unwrapResult\(await desktopApi\.ask\(question\)\);\s*window\.close\(\)/);
  assert.doesNotMatch(mascotScript, /unwrapResult\(await desktopApi\.ask\(question\)\);\s*panel\.hidden = true/);
});

test("독립 상세 패널은 완료·미룸·수정·삭제·리마인더 액션을 제공한다", async () => {
  const script = await readFile(scriptPath, "utf8");
  assert.match(script, /desktopApi\.complete/);
  assert.match(script, /desktopApi\.snooze/);
  assert.match(script, /desktopApi\.update/);
  assert.match(script, /desktopApi\.delete/);
  assert.match(script, /desktopApi\.reminder/);
  assert.match(script, /createExclusiveActionRunner/);
  assert.match(script, /runDetailAction/);
  assert.ok((script.match(/startVersion !== navigationVersion/g) ?? []).length >= 4);
});

test("panel view changes reset document scroll before rendering the next view", async () => {
  const script = await readFile(scriptPath, "utf8");

  assert.match(script, /function resetPanelScroll\(\)/);
  assert.match(script, /window\.scrollTo\(\{ top: 0, left: 0, behavior: "instant" \}\)/);
  assert.match(script, /function setTitle[\s\S]*?resetPanelScroll\(\)/);
  assert.match(script, /function renderError[\s\S]*?resetPanelScroll\(\)/);
});

test("캐릭터 메뉴와 알림 상세 버튼은 독립 패널 창을 연다", async () => {
  const script = await readFile("apps/desktop/src/renderer/character/mascot.js", "utf8");
  assert.match(script, /desktopWindow\?\.openPanel/);
  assert.match(script, /openStandalonePanel\(\{ view: targetView \}\)/);
  assert.match(script, /openStandalonePanel\(\{ view: "detail", itemId: contextItemId \}\)/);
  assert.match(script, /STANDALONE_PANEL_VIEWS\.has\(view\)/);
});
