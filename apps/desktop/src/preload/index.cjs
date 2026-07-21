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
  taskUpdate: "task:update",
  taskDelete: "task:delete",
  taskSetReminderOffset: "task:setReminderOffset",
  sourceList: "source:list",
  sourceRegister: "source:register",
  sourceRemove: "source:remove",
  syncRun: "sync:run",
  profileGet: "profile:get",
  profileSave: "profile:save",
  uiStateGet: "ui-state:get",
  uiStateSet: "ui-state:set",
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
  updateTask: (id, input) => ipcRenderer.invoke(CHANNELS.taskUpdate, { id, ...input }),
  deleteTask: (id) => ipcRenderer.invoke(CHANNELS.taskDelete, { id }),
  setReminderOffset: (id, offsetMinutes) =>
    ipcRenderer.invoke(CHANNELS.taskSetReminderOffset, { id, offsetMinutes }),
  listSources: () => ipcRenderer.invoke(CHANNELS.sourceList),
  registerSource: (type, value) => ipcRenderer.invoke(CHANNELS.sourceRegister, { type, value }),
  removeSource: (id) => ipcRenderer.invoke(CHANNELS.sourceRemove, { id }),
  sync: () => ipcRenderer.invoke(CHANNELS.syncRun),
  getProfile: () => ipcRenderer.invoke(CHANNELS.profileGet),
  saveProfile: (profile) => ipcRenderer.invoke(CHANNELS.profileSave, profile),
  getUiState: (key) => ipcRenderer.invoke(CHANNELS.uiStateGet, { key }),
  setUiState: (key, value) => ipcRenderer.invoke(CHANNELS.uiStateSet, { key, value }),
});

// apps/desktop/src/main/notifier/notificationEvent.ts의 NOTIFICATION_CHANNEL과 같은
// 문자열이어야 한다(위 CHANNELS와 같은 이유로 리터럴 중복).
const NOTIFICATION_CHANNEL = "notification";

// invoke/handle(요청-응답)이 아니라 Main이 먼저 보내는 이벤트라 on()으로 구독한다
// (docs/frontend-plan.md 6.2). 콜백은 NotificationEvent 하나만 받고, 반환값은
// 구독 해제 함수 — Renderer가 패널/창을 닫을 때 리스너가 쌓이지 않게 한다.
contextBridge.exposeInMainWorld("desktopEvents", {
  onNotification(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on(NOTIFICATION_CHANNEL, listener);
    return () => ipcRenderer.removeListener(NOTIFICATION_CHANNEL, listener);
  },
});
