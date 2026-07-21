const { contextBridge, ipcRenderer } = require("electron");

const SET_MOUSE_PASSTHROUGH = "desktop:set-mouse-passthrough";

contextBridge.exposeInMainWorld("desktopMascot", {
  setMousePassthrough(shouldIgnore) {
    if (typeof shouldIgnore === "boolean") {
      ipcRenderer.send(SET_MOUSE_PASSTHROUGH, shouldIgnore);
    }
  },
});

// docs/frontend-plan.md §6.1 조회 전용 IPC. 각 함수는 Main이 이미 { ok, data | error }
// 형태(Result<T>)로 반환하므로 여기서는 그대로 전달만 한다 — 가공은 Renderer 몫이다.
contextBridge.exposeInMainWorld("dododo", {
  today: {
    get: () => ipcRenderer.invoke("today:get"),
  },
  calendar: {
    get: () => ipcRenderer.invoke("calendar:get"),
  },
  inbox: {
    get: () => ipcRenderer.invoke("inbox:get"),
  },
  ask: {
    ask: (question) => ipcRenderer.invoke("ask:ask", { question }),
  },
  sync: {
    run: () => ipcRenderer.invoke("sync:run"),
  },
  profile: {
    get: () => ipcRenderer.invoke("profile:get"),
    save: (profile) => ipcRenderer.invoke("profile:save", profile),
  },
  uiState: {
    get: (key) => ipcRenderer.invoke("ui-state:get", { key }),
    set: (key, value) => ipcRenderer.invoke("ui-state:set", { key, value }),
  },
});
