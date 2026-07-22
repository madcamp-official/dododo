import { app, BrowserWindow, ipcMain, screen } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { closeDesktopContainer, getDesktopContainer } from "./container.ts";
import { registerIpcHandlers } from "./ipc/index.ts";
import { startDesktopWatch } from "./watch/desktopWatch.ts";
import { layoutWindowForCharacter } from "./dragGeometry.ts";
import { NOTIFICATION_CHANNEL } from "./notifier/notificationEvent.ts";
import { createOpenPanel } from "./windows/panelWindow.mjs";
import { parsePanelRoute } from "./windows/panelPayload.ts";
import { createOpenSettings } from "./windows/settingsWindow.mjs";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const rendererPath = path.join(currentDirectory, "../renderer/character/index.html");
const panelRendererPath = path.join(currentDirectory, "../renderer/panels/index.html");
const settingsRendererPath = path.join(currentDirectory, "../renderer/settings/index.html");
const preloadPath = path.join(currentDirectory, "../preload/index.cjs");
const characterWindows = new Set();

const SET_MOUSE_PASSTHROUGH = "desktop:set-mouse-passthrough";
const START_CHARACTER_DRAG = "desktop:start-character-drag";
const MOVE_CHARACTER_DRAG = "desktop:move-character-drag";
const END_CHARACTER_DRAG = "desktop:end-character-drag";
const CHARACTER_PLACEMENT = "desktop:character-placement";
const OPEN_PANEL = "desktop:open-panel";
const OPEN_SETTINGS = "desktop:open-settings";
const openSettings = createOpenSettings({ preloadPath, rendererPath: settingsRendererPath });

// 설정 창 열기는 데이터를 주고받는 Result<T> IPC(ipc/index.ts)가 아니라 순수 창
// 제어라 그 등록부와 분리해 여기(캐릭터 창 관련 다른 send 채널들과 같은 자리)에 둔다
// (docs/frontend-plan.md 6.7). 발신 창이 DoDoDo가 만든 캐릭터 창인지 확인해 다른
// send 채널들과 같은 방식으로 외부 payload를 신뢰하지 않는다.
ipcMain.on(OPEN_SETTINGS, (event) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  if (senderWindow === null || !characterWindows.has(senderWindow)) return;
  openSettings();
});
const characterDragOrigins = new WeakMap();
const characterPlacements = new WeakMap();
const EXPANDED_SIZE = { width: 680, height: 420 };
const CHARACTER_SIZE = { width: 174, height: 174 };
const openPanel = createOpenPanel({ preloadPath, rendererPath: panelRendererPath });

// docs/frontend-plan.md 6.8.2: 결과 패널 열기도 Result<T> 데이터 IPC가 아니라 순수
// 창 제어라 그 등록부(ipc/index.ts)와 분리한다. 발신 창이 DoDoDo가 만든 캐릭터
// 창인지 확인하고, payload는 parsePanelRoute로 허용 값만 통과시킨다(외부 URL·
// 임의 경로 거절). 배치는 발신 창(캐릭터)의 현재 위치·구석·모니터 workArea
// 기준으로 계산한다.
ipcMain.on(OPEN_PANEL, (event, payload) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  if (senderWindow === null || !characterWindows.has(senderWindow)) return;
  const route = parsePanelRoute(payload);
  if (route === undefined) return;

  const characterPlacement = characterPlacements.get(senderWindow) ?? "bottom-right";
  const workArea = screen.getDisplayMatching(senderWindow.getBounds()).workArea;
  openPanel(route, { characterPlacement, workArea });
});

// Renderer가 mouse-ignore 초기 상태의 단독 소유자다(위 mousemove 주석 참고). Renderer
// 스크립트가 실패하거나 아직 SET_MOUSE_PASSTHROUGH를 한 번도 못 보낸 상태로 남으면
// 투명·alwaysOnTop 창 전체가 계속 클릭을 가로막을 수 있다 — 일정 시간 안에 Renderer가
// 보고하지 않으면 안전한 기본값(click-through)으로 되돌린다.
const PASSTHROUGH_FALLBACK_MS = 2000;
const passthroughFallbacks = new WeakMap();

function schedulePassthroughFallback(characterWindow) {
  const timeoutId = setTimeout(() => {
    passthroughFallbacks.delete(characterWindow);
    if (!characterWindow.isDestroyed()) characterWindow.setIgnoreMouseEvents(true, { forward: true });
  }, PASSTHROUGH_FALLBACK_MS);
  passthroughFallbacks.set(characterWindow, timeoutId);
}

function cancelPassthroughFallback(characterWindow) {
  const timeoutId = passthroughFallbacks.get(characterWindow);
  if (timeoutId === undefined) return;
  clearTimeout(timeoutId);
  passthroughFallbacks.delete(characterWindow);
}

ipcMain.on(SET_MOUSE_PASSTHROUGH, (event, shouldIgnore) => {
  const characterWindow = BrowserWindow.fromWebContents(event.sender);
  if (characterWindow === null || !characterWindows.has(characterWindow) || typeof shouldIgnore !== "boolean") {
    return;
  }
  cancelPassthroughFallback(characterWindow);
  characterWindow.setIgnoreMouseEvents(shouldIgnore, { forward: true });
});

ipcMain.on(START_CHARACTER_DRAG, (event, pointer) => {
  const characterWindow = BrowserWindow.fromWebContents(event.sender);
  if (characterWindow === null || !characterWindows.has(characterWindow) || !isScreenPoint(pointer)) return;
  const [windowX, windowY] = characterWindow.getPosition();
  const placement = characterPlacements.get(characterWindow) ?? "bottom-right";
  const offsetX = placement.endsWith("left") ? 4 : EXPANDED_SIZE.width - CHARACTER_SIZE.width - 4;
  const offsetY = placement.startsWith("top") ? 4 : EXPANDED_SIZE.height - CHARACTER_SIZE.height - 4;
  characterDragOrigins.set(characterWindow, {
    pointerX: pointer.x,
    pointerY: pointer.y,
    characterX: windowX + offsetX,
    characterY: windowY + offsetY,
  });
  characterWindow.setIgnoreMouseEvents(false);
});

ipcMain.on(MOVE_CHARACTER_DRAG, (event, pointer) => {
  const characterWindow = BrowserWindow.fromWebContents(event.sender);
  if (characterWindow === null || !characterWindows.has(characterWindow) || !isScreenPoint(pointer)) return;
  const origin = characterDragOrigins.get(characterWindow);
  if (origin === undefined) return;
  const desiredX = Math.round(origin.characterX + pointer.x - origin.pointerX);
  const desiredY = Math.round(origin.characterY + pointer.y - origin.pointerY);
  const workArea = screen.getDisplayNearestPoint(pointer).workArea;
  const layout = layoutWindowForCharacter(
    { x: desiredX, y: desiredY },
    EXPANDED_SIZE,
    CHARACTER_SIZE,
    workArea,
    4,
    characterPlacements.get(characterWindow),
    Number.POSITIVE_INFINITY,
  );
  characterWindow.setPosition(layout.windowPosition.x, layout.windowPosition.y);
  origin.lastCharacterPosition = layout.characterPosition;
  origin.lastWorkArea = workArea;
});

ipcMain.on(END_CHARACTER_DRAG, (event) => {
  const characterWindow = BrowserWindow.fromWebContents(event.sender);
  if (characterWindow === null) return;
  const origin = characterDragOrigins.get(characterWindow);
  characterDragOrigins.delete(characterWindow);
  if (origin?.lastCharacterPosition === undefined || origin.lastWorkArea === undefined) return;

  // 드래그 중에는 placement를 고정해 기준점 변경으로 캐릭터가 튀지 않게 한다.
  // 포인터를 놓은 뒤 최종 사분면을 한 번만 계산해 주변 UI 방향을 갱신한다.
  const finalLayout = layoutWindowForCharacter(
    origin.lastCharacterPosition,
    EXPANDED_SIZE,
    CHARACTER_SIZE,
    origin.lastWorkArea,
  );
  characterPlacements.set(characterWindow, finalLayout.placement);
  characterWindow.setPosition(finalLayout.windowPosition.x, finalLayout.windowPosition.y);
  characterWindow.webContents.send(CHARACTER_PLACEMENT, finalLayout.placement);
});

function isScreenPoint(value) {
  return value !== null
    && typeof value === "object"
    && Number.isFinite(value.x)
    && Number.isFinite(value.y);
}

function createCharacterWindow() {
  const characterWindow = new BrowserWindow({
    width: EXPANDED_SIZE.width,
    height: EXPANDED_SIZE.height,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    hasShadow: false,
    backgroundColor: "#00000000",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: preloadPath,
    },
  });

  characterWindow.setMenuBarVisibility(false);
  characterWindows.add(characterWindow);
  characterPlacements.set(characterWindow, "bottom-right");
  schedulePassthroughFallback(characterWindow);
  characterWindow.on("closed", () => {
    cancelPassthroughFallback(characterWindow);
    characterDragOrigins.delete(characterWindow);
    characterWindows.delete(characterWindow);
    characterPlacements.delete(characterWindow);
  });
  void characterWindow.loadFile(rendererPath).then(() => {
    characterWindow.webContents.send(CHARACTER_PLACEMENT, characterPlacements.get(characterWindow));
    if (process.env.DODODO_NOTIFICATION_PREVIEW === "1") {
      characterWindow.webContents.send(NOTIFICATION_CHANNEL, {
        kind: "sync-complete",
        message: "알림 말풍선이 이렇게 표시됩니다.",
        createdAt: new Date().toISOString(),
      });
    }
    if (process.platform === "linux") {
      // Linux에서는 setIgnoreMouseEvents({ forward: true })가 mousemove를 Renderer로
      // 전달하지 않아 다시 drag 상태로 돌아올 수 없다. 현재 idle 에셋의 불투명 경계를
      // 감싸는 작은 shape만 hit-test 대상으로 두어 투명 여백이 아래 창을 막지 않게 한다.
      characterWindow.setShape([{ x: 76, y: 16, width: 168, height: 272 }]);
    }
  }).catch((error) => {
    console.error("DoDoDo 데스크톱 Renderer를 열지 못했습니다.", error);
  });
}

let desktopWatchHandle;

app.whenReady().then(() => {
  // Source 등록 설정(dododo.sources.json)은 DODODO_SOURCE_CONFIG 미설정 시
  // process.cwd() 기준 상대 경로로 찾는다(apps/cli/src/runtime/sourceInputConfig.ts) —
  // 패키지 앱은 더블클릭으로 실행돼 cwd가 설치 폴더거나 실행 방식마다 달라질 수 있어,
  // source:register로 쓴 설정을 다음 실행에서 못 찾는 문제가 생긴다(doyeonid, PR #84 리뷰).
  // DODODO_SOURCE_CONFIG를 강제로 채우면 "명시적으로 지정했는데 파일이 없다"는
  // 별개의 오류 경로를 타 버려(container.ts) 소스 미등록 상태의 Fixture 데모 폴백이
  // 깨진다 — 대신 cwd 자체를 userData로 옮겨서 기존 "미설정 시 기본 상대 경로" 분기를
  // 그대로 타게 한다. DB 경로 기본값(dbConfig.ts)도 같은 방식으로 cwd 상대라 이 chdir로
  // 함께 안정되지만, DB는 아래 databasePath로 명시 지정도 유지한다(이중 안전장치).
  process.chdir(app.getPath("userData"));

  // apps/cli의 createCliContainer를 그대로 재사용한다(container.ts) — CLI 명령마다
  // 새로 만들고 버리는 것과 달리, 앱 실행 내내 하나만 만들어 모든 IPC 호출이 공유한다.
  const container = getDesktopContainer();
  registerIpcHandlers(container);
  // CLI의 watch 명령과 달리 사용자가 따로 실행하지 않아도 앱이 떠 있는 동안 상시
  // 돈다(docs/frontend-plan.md 3번) — before-quit에서 stop()으로 멈춘다.
  desktopWatchHandle = startDesktopWatch(container);
  createCharacterWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createCharacterWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// SQLite를 열었으면(DODODO_DB_PATH가 실제 경로) 앱이 어떻게 종료되든(메뉴 종료,
// window-all-closed, OS 종료) 파일 잠금을 풀어야 다음 실행이 곧바로 붙을 수 있다
// (apps/cli/src/index.ts의 try/finally와 같은 이유).
app.on("before-quit", () => {
  desktopWatchHandle?.stop();
  closeDesktopContainer();
});
