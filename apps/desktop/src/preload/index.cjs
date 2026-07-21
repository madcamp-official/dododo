const { contextBridge, ipcRenderer } = require("electron");

const SET_MOUSE_PASSTHROUGH = "desktop:set-mouse-passthrough";

contextBridge.exposeInMainWorld("desktopMascot", {
  setMousePassthrough(shouldIgnore) {
    if (typeof shouldIgnore === "boolean") {
      ipcRenderer.send(SET_MOUSE_PASSTHROUGH, shouldIgnore);
    }
  },
});
