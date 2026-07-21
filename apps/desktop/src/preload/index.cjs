const { contextBridge, ipcRenderer } = require("electron");

const SET_MOUSE_PASSTHROUGH = "desktop:set-mouse-passthrough";
const START_CHARACTER_DRAG = "desktop:start-character-drag";
const MOVE_CHARACTER_DRAG = "desktop:move-character-drag";
const END_CHARACTER_DRAG = "desktop:end-character-drag";

contextBridge.exposeInMainWorld("desktopMascot", {
  setMousePassthrough(shouldIgnore) {
    if (typeof shouldIgnore === "boolean") {
      ipcRenderer.send(SET_MOUSE_PASSTHROUGH, shouldIgnore);
    }
  },
  startDrag(x, y) {
    ipcRenderer.send(START_CHARACTER_DRAG, { x, y });
  },
  moveDrag(x, y) {
    ipcRenderer.send(MOVE_CHARACTER_DRAG, { x, y });
  },
  endDrag() {
    ipcRenderer.send(END_CHARACTER_DRAG);
  },
});

// apps/desktop/src/main/ipc/index.ts의 IPC_CHANNELS와 같은 문자열이어야 한다. preload는
// sandbox 안에서 CommonJS(require)로만 안전하게 동작해(#54가 이미 이 이유로 .cjs를
// 선택함) Main 쪽 .ts 상수 파일을 그대로 import할 수 없다 — 그래서 리터럴로 다시
// 적는다. 채널 이름을 바꿀 땐 두 파일을 같이 고쳐야 한다.
const CHANNELS = {
  todayGet: "today:get",
  calendarGet: "calendar:get",
  inboxGet: "inbox:get",
  askAsk: "ask:ask",
  addSubmit: "add:submit",
  taskDetail: "task:detail",
  taskComplete: "task:complete",
  taskSnooze: "task:snooze",
  syncRun: "sync:run",
};

// Result<T>({ ok, data } | { ok, error })를 그대로 돌려준다 — Renderer가 .ok로 분기한다
// (docs/frontend-plan.md 6.1/6.5).
contextBridge.exposeInMainWorld("desktopApi", {
  getToday: () => ipcRenderer.invoke(CHANNELS.todayGet),
  getCalendar: () => ipcRenderer.invoke(CHANNELS.calendarGet),
  getInbox: () => ipcRenderer.invoke(CHANNELS.inboxGet),
  ask: (question) => ipcRenderer.invoke(CHANNELS.askAsk, { question }),
  addSubmit: (input) => ipcRenderer.invoke(CHANNELS.addSubmit, input),
  getTaskDetail: (id) => ipcRenderer.invoke(CHANNELS.taskDetail, { id }),
  completeTask: (id) => ipcRenderer.invoke(CHANNELS.taskComplete, { id }),
  snoozeTask: (id, until) => ipcRenderer.invoke(CHANNELS.taskSnooze, { id, until }),
  sync: () => ipcRenderer.invoke(CHANNELS.syncRun),
});
