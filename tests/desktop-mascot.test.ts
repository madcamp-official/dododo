import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import test from "node:test";

const desktopFiles = [
  "apps/desktop/src/main/index.mjs",
  "apps/desktop/src/preload/index.cjs",
  "apps/desktop/src/renderer/character/mascot.js",
  "apps/desktop/src/renderer/character/notification-state.mjs",
  "apps/desktop/src/renderer/character/schedule-form.mjs",
  "apps/desktop/src/renderer/character/profile-form.mjs",
  "apps/desktop/src/renderer/character/daily-summary.mjs",
  "apps/desktop/src/renderer/character/schedule-management.mjs",
  "apps/desktop/src/renderer/character/study-session-ui.mjs",
  "apps/desktop/src/renderer/character/character-expression.mjs",
];

test("desktop mascot JavaScript 진입점은 모두 구문 검사를 통과한다", () => {
  for (const path of desktopFiles) {
    const result = spawnSync(process.execPath, ["--check", path], { encoding: "utf8" });
    assert.equal(result.status, 0, `${path}: ${result.stderr}`);
  }
});

test("desktop 배포 이름·아이콘·Fixture 제외 설정은 DoToRi 기준이다", async () => {
  const [packageJson, desktopContainer, desktopMain] = await Promise.all([
    readFile("package.json", "utf8"),
    readFile("apps/desktop/src/main/container.ts", "utf8"),
    readFile("apps/desktop/src/main/index.mjs", "utf8"),
  ]);
  const manifest = JSON.parse(packageJson);

  assert.equal(manifest.name, "dotori");
  assert.equal(manifest.version, "0.1.1");
  assert.equal(manifest.build.productName, "DoToRi");
  assert.equal(manifest.build.appId, "dev.dotori.desktop");
  assert.equal(manifest.build.icon, "apps/desktop/resources/character/idle.png");
  assert.equal(manifest.build.files.includes("fixtures/**/*"), false);
  assert.match(desktopContainer, /useFixtureFallback:\s*false/);
  assert.match(desktopContainer, /"dotori\.db"/);
  assert.match(desktopMain, /app\.setName\("DoToRi"\)/);
  assert.match(desktopMain, /app\.setPath\("userData", path\.join\(app\.getPath\("appData"\), "DoToRi"\)\)/);
  assert.ok(
    desktopMain.indexOf('app.setPath("userData"') < desktopMain.indexOf("app.whenReady()"),
    "userData 경로는 container와 IPC를 만드는 whenReady 이전에 고정해야 한다",
  );
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

  // schedulePassthroughFallback은 Renderer가 응답 없을 때만 늦게 개입하는 안전망이라
  // 예외다(아래 폴백 테스트 참고) — 그 함수 바깥에는 setIgnoreMouseEvents(true)가 없어야
  // Renderer가 여전히 정상 경로의 단독 소유자다.
  const mainWithoutFallback = main.replace(/function schedulePassthroughFallback[\s\S]*?\r?\n\}\r?\n/, "");
  assert.doesNotMatch(mainWithoutFallback, /setIgnoreMouseEvents\(true/);
  assert.match(renderer, /setMousePassthrough\(isIgnoringMouse\)/);
  assert.match(renderer, /startCharacterDrag/);
  assert.match(renderer, /setPointerCapture/);
  assert.match(preload, /desktop:start-character-drag/);
  assert.match(main, /characterWindow\.setPosition/);
  assert.match(style, /-webkit-app-region: no-drag/);
});

test("desktop mascot은 Renderer가 응답 없을 때 click-through로 되돌아가는 폴백을 둔다", async () => {
  const main = await readFile("apps/desktop/src/main/index.mjs", "utf8");

  assert.match(main, /PASSTHROUGH_FALLBACK_MS/);
  assert.match(main, /schedulePassthroughFallback\(characterWindow\)/);
  assert.match(main, /cancelPassthroughFallback\(characterWindow\)/);
  assert.match(main, /setIgnoreMouseEvents\(true, \{ forward: true \}\)/);
});

test("desktop mascot keeps an open menu or embedded panel interactive", async () => {
  const renderer = await readFile("apps/desktop/src/renderer/character/mascot.js", "utf8");

  assert.match(renderer, /popupMenu\?\.hidden === false \|\| panel\?\.hidden === false/);
  assert.match(renderer, /!hasOpenInteractiveSurface && !interactive && !isOpaquePixel/);
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
  assert.match(style, /\.panel\s*\{[^}]*width:\s*460px;/s);
  assert.match(style, /body\[data-character-placement\$="left"\] \.panel \{ right: 26px; left: auto; \}/);
  assert.match(style, /body\[data-character-placement\$="right"\] \.panel \{ right: auto; left: 26px; \}/);
  assert.doesNotMatch(main, /characterWindow\.setBounds/);
});

test("desktop mascot의 추가·같이 공부하기 패널은 캐릭터 위치와 무관하게 전체 창 높이를 사용한다", async () => {
  const style = await readFile("apps/desktop/src/renderer/character/style.css", "utf8");

  assert.match(style, /\.panel\s*\{[^}]*top:\s*0;[^}]*bottom:\s*0;[^}]*width:\s*460px;/s);
  assert.doesNotMatch(style, /body\[data-character-placement\^="top"\]\s+\.panel\s*\{/);
  assert.doesNotMatch(style, /body\[data-character-placement\^="bottom"\]\s+\.panel\s*\{/);
});

test("desktop mascot 상세 버튼 오류 처리는 정의되지 않은 상태를 참조하지 않는다", async () => {
  const renderer = await readFile("apps/desktop/src/renderer/character/mascot.js", "utf8");
  const openDetail = renderer.match(/async function openDetail[\s\S]*?\n\}/)?.[0] ?? "";

  assert.doesNotMatch(openDetail, /throwOnError/);
  assert.match(openDetail, /renderError\(error\)/);
});

test("desktop mascot은 액션 후 목록 갱신 실패 시 제목을 목록 뷰 제목으로 남겨두지 않는다", async () => {
  const renderer = await readFile("apps/desktop/src/renderer/character/mascot.js", "utf8");
  const runTaskAction = renderer.match(/async function runTaskAction[\s\S]*?\n\}/)?.[0] ?? "";

  assert.match(runTaskAction, /panelTitle\.textContent = "처리 완료"/);
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
  assert.match(renderer, /runExclusivePanelAction/);
  assert.match(renderer, /panelContent\.querySelectorAll\("button, input, textarea"\)/);
  assert.match(renderer, /createExclusiveActionRunner/);
  assert.match(renderer, /처리는 완료됐지만 목록 갱신에 실패했습니다/);
  assert.match(style, /\.answer\s*\{[^}]*white-space:\s*pre-line;/s);
  assert.doesNotMatch(adapter, /mock-task|mock-opportunity/);
});

test("desktop mascot은 notification 이벤트를 말풍선·배지·상세보기로 연결한다", async () => {
  const [main, html, renderer, style] = await Promise.all([
    readFile("apps/desktop/src/main/index.mjs", "utf8"),
    readFile("apps/desktop/src/renderer/character/index.html", "utf8"),
    readFile("apps/desktop/src/renderer/character/mascot.js", "utf8"),
    readFile("apps/desktop/src/renderer/character/style.css", "utf8"),
  ]);

  assert.match(html, /data-notification-bubble/);
  assert.match(html, /data-notification-badge/);
  assert.match(renderer, /subscribeToNotifications\(\)/);
  assert.match(renderer, /notificationSubscriptionRetry = window\.setTimeout/);
  assert.match(renderer, /console\.warn\("DoToRi 알림 이벤트 브리지를 찾지 못해/);
  assert.match(renderer, /unsubscribeNotifications\?\.\(\)/);
  assert.match(renderer, /notificationMode\(next\.kind\) === "quiet" \? "polite" : "assertive"/);
  assert.match(renderer, /notificationStore\.takeImmediate/);
  assert.match(renderer, /notificationStore\.markQuietRead/);
  assert.match(renderer, /openDetail\(event\.contextItemId\)/);
  assert.match(main, /DODODO_NOTIFICATION_PREVIEW/);
  assert.match(main, /webContents\.send\(NOTIFICATION_CHANNEL/);
  assert.match(style, /\.notification-bubble\s*\{/);
  assert.match(style, /\.desktop-shell:has\(\.panel:not\(\[hidden\]\)\) \.notification-bubble/);
  assert.match(style, /\.notification-badge\s*\{/);
});

test("desktop mascot 상세 패널은 일정 수정·삭제·리마인더 API를 연결한다", async () => {
  const [renderer, adapter, style] = await Promise.all([
    readFile("apps/desktop/src/renderer/character/mascot.js", "utf8"),
    readFile("apps/desktop/src/renderer/character/desktop-api.mjs", "utf8"),
    readFile("apps/desktop/src/renderer/character/style.css", "utf8"),
  ]);

  assert.match(adapter, /updateTask/);
  assert.match(adapter, /deleteTask/);
  assert.match(adapter, /setReminderOffset/);
  assert.match(renderer, /data-schedule-edit-form/);
  assert.match(renderer, /desktopApi\.update/);
  assert.match(renderer, /window\.confirm/);
  assert.match(renderer, /desktopApi\.delete/);
  assert.match(renderer, /desktopApi\.reminder/);
  assert.equal((renderer.match(/await runExclusivePanelAction/g) ?? []).length, 6);
  assert.match(renderer, /item\.kind === "event" \? `<div class="form-field">/);
  assert.match(style, /\.danger-button\s*\{/);
  assert.match(style, /\.reminder-form\s*\{/);
});

test("desktop mascot opens the standalone settings window without embedded settings UI", async () => {
  const [renderer, preload] = await Promise.all([
    readFile("apps/desktop/src/renderer/character/mascot.js", "utf8"),
    readFile("apps/desktop/src/preload/index.cjs", "utf8"),
  ]);

  assert.match(renderer, /view === "settings"\) openSettingsWindow\(\)/);
  assert.match(renderer, /window\.desktopWindow\?\.openSettings/);
  assert.match(renderer, /설정 창을 열 수 없습니다/);
  assert.doesNotMatch(renderer, /function renderSettings/);
  assert.doesNotMatch(renderer, /data-settings-profile/);
  assert.doesNotMatch(renderer, /data-settings-source/);
  assert.match(preload, /openSettings/);
});

test("desktop mascot shows a once-per-day summary bubble linked to Today", async () => {
  const [renderer, adapter, notificationState] = await Promise.all([
    readFile("apps/desktop/src/renderer/character/mascot.js", "utf8"),
    readFile("apps/desktop/src/renderer/character/desktop-api.mjs", "utf8"),
    readFile("apps/desktop/src/renderer/character/notification-state.mjs", "utf8"),
  ]);

  assert.match(adapter, /getUiState/);
  assert.match(adapter, /setUiState/);
  assert.match(renderer, /showDailySummaryOnFirstLaunch/);
  assert.match(renderer, /lastDailySummaryDate/);
  assert.match(renderer, /dailySummaryRetryDelayMs/);
  assert.match(renderer, /dailySummaryRetryTimer = window\.setTimeout/);
  assert.match(renderer, /window\.clearTimeout\(dailySummaryRetryTimer\)/);
  assert.match(renderer, /targetView === "today"/);
  assert.match(renderer, /openStandalonePanel\(\{ view: targetView \}\)/);
  assert.match(notificationState, /daily-summary/);
  assert.match(renderer, /next\.targetView === "today" \? "오늘 보기" : "자세히 보기"/);
});

test("desktop calendar renders schedules as day and time groups", async () => {
  const [renderer, style] = await Promise.all([
    readFile("apps/desktop/src/renderer/character/mascot.js", "utf8"),
    readFile("apps/desktop/src/renderer/character/style.css", "utf8"),
  ]);

  assert.match(renderer, /buildWeeklyCalendar\(entries\)/);
  assert.match(renderer, /class="weekly-calendar"/);
  assert.match(renderer, /class="calendar-day"/);
  assert.match(renderer, /class="calendar-entry \$\{item\.kind === "event" \? "event" : "deadline"\}"/);
  assert.match(renderer, /<time datetime="\$\{escapeHtml\(at\)\}">\$\{escapeHtml\(timeLabel\)\}<\/time>/);
  assert.match(renderer, /data-item-id/);
  assert.match(style, /\.calendar-day\s*\{/);
  assert.match(style, /\.calendar-entry\.deadline\s*\{/);
});

test("desktop mascot provides study consent, start, end, and summary flow", async () => {
  const [html, renderer, expressions] = await Promise.all([
    readFile("apps/desktop/src/renderer/character/index.html", "utf8"),
    readFile("apps/desktop/src/renderer/character/mascot.js", "utf8"),
    readFile("apps/desktop/src/renderer/character/character-expression.mjs", "utf8"),
  ]);
  assert.match(html, /data-action="study"/);
  assert.match(renderer, /data-study-consent/);
  assert.match(renderer, /desktopApi\.studyStart/);
  assert.match(renderer, /desktopApi\.studyEnd/);
  assert.match(renderer, /desktopApi\.studyGet/);
  assert.match(renderer, /const studySessionRestorePromise = restoreStudySession\(\)/);
  assert.match(renderer, /openStudySession\(\).*await studySessionRestorePromise/s);
  assert.match(renderer, /startStudySession\(\).*runExclusivePanelAction/s);
  assert.match(renderer, /endStudySession\(\).*runExclusivePanelAction/s);
  assert.match(renderer, /studySummaryView/);
  assert.match(renderer, /restingExpression/);
  assert.match(expressions, /reading\.png/);
  assert.match(renderer, /data-study-elapsed/);
  assert.match(renderer, /data-study-status aria-live="polite"/);
  assert.doesNotMatch(renderer, /study-progress" aria-live/);
});

test("추가와 같이 공부하기 내부 패널도 독립 패널과 같은 크기를 사용한다", async () => {
  const style = await readFile("apps/desktop/src/renderer/character/style.css", "utf8");
  assert.match(style, /\.panel\s*\{[\s\S]*?width:\s*460px/);
  assert.match(style, /\.panel\s*\{[\s\S]*?top:\s*0;[\s\S]*?bottom:\s*0/);
});

test("desktop mascot changes expression for notifications and restores its activity state", async () => {
  const renderer = await readFile("apps/desktop/src/renderer/character/mascot.js", "utf8");

  assert.match(renderer, /setCharacterExpression\(notificationExpression\(next\.kind\)\)/);
  assert.match(renderer, /notificationStore\.hasImmediate\(\).*showNextNotification\(\)/s);
  assert.match(renderer, /result\.event\.kind === "answer".*activeNotification\?\.kind === "answer".*dismissActiveNotification\(\)/s);
  assert.match(renderer, /else\s*(?:\{\s*)?updateStudyCharacter\(\)/);
  assert.match(renderer, /updateStudyCharacter\(\).*activeNotification !== undefined.*return.*restingExpression/s);
  assert.match(renderer, /character\.addEventListener\("load", prepareAlphaMask/);
});

test("desktop mascot은 모든 미사용 포즈와 이펙트를 생각·왕복 산책·알림에 연결한다", async () => {
  const [html, renderer, expressions] = await Promise.all([
    readFile("apps/desktop/src/renderer/character/index.html", "utf8"),
    readFile("apps/desktop/src/renderer/character/mascot.js", "utf8"),
    readFile("apps/desktop/src/renderer/character/character-expression.mjs", "utf8"),
  ]);

  assert.match(html, /data-character-effect/);
  for (const asset of ["thinking.png", "walk-01.png", "walk-02.png", "walk-side-01.png", "walk-side-02.png"]) {
    assert.match(renderer, new RegExp(asset.replace(".", "\\.")));
  }
  for (const effect of ["dust.png", "speed-lines.png", "sparkle.png", "heart.png", "question.png"]) {
    assert.match(renderer, new RegExp(effect.replace(".", "\\.")));
  }
  assert.match(expressions, /exclamation\.png/);
  assert.match(expressions, /sweat\.png/);
  assert.match(renderer, /runPatrol/);
  assert.match(renderer, /STUDY_IDLE_PATROL_MESSAGE = "지금 오랫동안 같은 화면인데 자고 계시는 거 아니죠\?"/);
  assert.match(renderer, /characterEffect\.dataset\.effect = asset/);
  assert.match(renderer, /window\.screen\.availWidth/);
  assert.match(renderer, /bridge\.startDrag\(startX, pointerY\)/);
  assert.match(renderer, /bridge\.moveDrag\(startX \+ \(targetX - startX\) \* eased, pointerY\)/);
  assert.match(renderer, /next\.kind === "distraction" && next\.message === STUDY_IDLE_PATROL_MESSAGE/);
  const style = await readFile("apps/desktop/src/renderer/character/style.css", "utf8");
  assert.match(style, /is-walking[^}]*data-effect="speed-lines\.png"[^}]*z-index:\s*2[^}]*top:\s*48px/s);
  assert.match(style, /data-walk-direction="right"[^}]*data-effect="speed-lines\.png"[^}]*left:\s*-15px/s);
  assert.match(style, /data-walk-direction="left"[^}]*data-effect="speed-lines\.png"[^}]*right:\s*-15px/s);
});
