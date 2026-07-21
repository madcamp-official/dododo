import { app, BrowserWindow } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const rendererPath = path.join(currentDirectory, "../renderer/index.html");
const characterWindows = new Set();

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
    },
  });

  characterWindow.setMenuBarVisibility(false);
  characterWindows.add(characterWindow);
  characterWindow.on("closed", () => {
    characterWindows.delete(characterWindow);
  });
  void characterWindow.loadFile(rendererPath);
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
