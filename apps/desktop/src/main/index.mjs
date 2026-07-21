import { app, BrowserWindow, ipcMain, screen } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { closeDesktopContainer, getDesktopContainer } from "./container.ts";
import { registerIpcHandlers } from "./ipc/index.ts";
import { clampPositionToWorkArea } from "./dragGeometry.ts";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const rendererPath = path.join(currentDirectory, "../renderer/character/index.html");
const preloadPath = path.join(currentDirectory, "../preload/index.cjs");
const characterWindows = new Set();

const SET_MOUSE_PASSTHROUGH = "desktop:set-mouse-passthrough";
const START_CHARACTER_DRAG = "desktop:start-character-drag";
const MOVE_CHARACTER_DRAG = "desktop:move-character-drag";
const END_CHARACTER_DRAG = "desktop:end-character-drag";
const characterDragOrigins = new WeakMap();
const EXPANDED_SIZE = { width: 680, height: 420 };

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
  characterDragOrigins.set(characterWindow, { pointerX: pointer.x, pointerY: pointer.y, windowX, windowY });
  characterWindow.setIgnoreMouseEvents(false);
});

ipcMain.on(MOVE_CHARACTER_DRAG, (event, pointer) => {
  const characterWindow = BrowserWindow.fromWebContents(event.sender);
  if (characterWindow === null || !characterWindows.has(characterWindow) || !isScreenPoint(pointer)) return;
  const origin = characterDragOrigins.get(characterWindow);
  if (origin === undefined) return;
  const desiredX = Math.round(origin.windowX + pointer.x - origin.pointerX);
  const desiredY = Math.round(origin.windowY + pointer.y - origin.pointerY);
  const workArea = screen.getDisplayNearestPoint(pointer).workArea;
  const [windowWidth, windowHeight] = characterWindow.getSize();
  const clamped = clampPositionToWorkArea(
    { x: desiredX, y: desiredY },
    { width: windowWidth, height: windowHeight },
    workArea,
  );
  characterWindow.setPosition(clamped.x, clamped.y);
});

ipcMain.on(END_CHARACTER_DRAG, (event) => {
  const characterWindow = BrowserWindow.fromWebContents(event.sender);
  if (characterWindow !== null) characterDragOrigins.delete(characterWindow);
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
  schedulePassthroughFallback(characterWindow);
  characterWindow.on("closed", () => {
    cancelPassthroughFallback(characterWindow);
    characterDragOrigins.delete(characterWindow);
    characterWindows.delete(characterWindow);
  });
  void characterWindow.loadFile(rendererPath).then(() => {
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

app.whenReady().then(() => {
  // apps/cli의 createCliContainer를 그대로 재사용한다(container.ts) — CLI 명령마다
  // 새로 만들고 버리는 것과 달리, 앱 실행 내내 하나만 만들어 모든 IPC 호출이 공유한다.
  registerIpcHandlers(getDesktopContainer());
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
  closeDesktopContainer();
});
