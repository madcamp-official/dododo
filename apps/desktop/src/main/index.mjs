import { app, BrowserWindow, ipcMain } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const rendererPath = path.join(currentDirectory, "../renderer/character/index.html");
const preloadPath = path.join(currentDirectory, "../preload/index.cjs");
const characterWindows = new Set();

const SET_MOUSE_PASSTHROUGH = "desktop:set-mouse-passthrough";

ipcMain.on(SET_MOUSE_PASSTHROUGH, (event, shouldIgnore) => {
  const characterWindow = BrowserWindow.fromWebContents(event.sender);
  if (characterWindow === null || !characterWindows.has(characterWindow) || typeof shouldIgnore !== "boolean") {
    return;
  }
  characterWindow.setIgnoreMouseEvents(shouldIgnore, { forward: true });
});

function createCharacterWindow() {
  const characterWindow = new BrowserWindow({
    width: 320,
    height: 320,
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
  characterWindow.on("closed", () => {
    characterWindows.delete(characterWindow);
  });
  void characterWindow.loadFile(rendererPath).then(() => {
    if (process.platform === "linux") {
      // Linux에서는 setIgnoreMouseEvents({ forward: true })가 mousemove를 Renderer로
      // 전달하지 않아 다시 drag 상태로 돌아올 수 없다. 현재 idle 에셋의 불투명 경계를
      // 감싸는 작은 shape만 hit-test 대상으로 두어 투명 여백이 아래 창을 막지 않게 한다.
      characterWindow.setShape([{ x: 76, y: 16, width: 168, height: 272 }]);
      return;
    }
    // Windows/macOS는 Renderer가 픽셀 alpha를 검사해 불투명 캐릭터 위에서만 이 값을
    // false로 되돌린다. 시작은 click-through여야 투명 여백이 다른 앱을 가리지 않는다.
    characterWindow.setIgnoreMouseEvents(true, { forward: true });
  }).catch((error) => {
    console.error("DoDoDo 데스크톱 Renderer를 열지 못했습니다.", error);
  });
}

app.whenReady().then(() => {
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
