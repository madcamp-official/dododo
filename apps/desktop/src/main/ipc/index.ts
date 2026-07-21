import { app, ipcMain } from "electron";
import { join } from "node:path";

import type { CliContainer } from "../../../../cli/src/runtime/container.ts";
import {
  handleAddSubmit,
  handleAsk,
  handleCalendar,
  handleInbox,
  handleProfileGet,
  handleProfileSave,
  handleSyncRun,
  handleTaskComplete,
  handleTaskDelete,
  handleTaskDetail,
  handleTaskSnooze,
  handleTaskUpdate,
  handleToday,
  handleUiStateGet,
  handleUiStateSet,
} from "./handlers.ts";

// docs/frontend-plan.md 6.1의 "영역:동작" 채널 이름 규칙. 이 상수만 preload와 공유하면
// 되므로 여기 한 곳에 모아 둔다 — Renderer는 이 문자열을 직접 안 쓰고 preload가 감싼
// 함수만 호출한다(contextBridge 경계 밖 문자열 불일치를 막는다).
export const IPC_CHANNELS = {
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
  syncRun: "sync:run",
  profileGet: "profile:get",
  profileSave: "profile:save",
  uiStateGet: "ui-state:get",
  uiStateSet: "ui-state:set",
} as const;

// payload 검증과 실제 처리는 handlers.ts(electron 미의존, node --test로 검증)에 있다 —
// 여기는 채널 이름을 그 함수에 연결하기만 하는 얇은 배선이다. Main에 앱 컨테이너가
// 이미 생겨 있어야 등록할 수 있다 — index.mjs가 app.whenReady() 이후 container를
// 만든 뒤 이 함수를 한 번만 호출한다.
export function registerIpcHandlers(container: CliContainer): void {
  ipcMain.handle(IPC_CHANNELS.todayGet, () => handleToday(container));
  ipcMain.handle(IPC_CHANNELS.calendarGet, () => handleCalendar(container));
  ipcMain.handle(IPC_CHANNELS.inboxGet, () => handleInbox(container));
  ipcMain.handle(IPC_CHANNELS.askAsk, (_event, input: unknown) => handleAsk(container, input));
  ipcMain.handle(IPC_CHANNELS.addSubmit, (_event, input: unknown) => handleAddSubmit(container, input));
  ipcMain.handle(IPC_CHANNELS.taskDetail, (_event, input: unknown) => handleTaskDetail(container, input));
  ipcMain.handle(IPC_CHANNELS.taskComplete, (_event, input: unknown) => handleTaskComplete(container, input));
  ipcMain.handle(IPC_CHANNELS.taskSnooze, (_event, input: unknown) => handleTaskSnooze(container, input));
  ipcMain.handle(IPC_CHANNELS.taskUpdate, (_event, input: unknown) => handleTaskUpdate(container, input));
  ipcMain.handle(IPC_CHANNELS.taskDelete, (_event, input: unknown) => handleTaskDelete(container, input));
  ipcMain.handle(IPC_CHANNELS.syncRun, () => handleSyncRun(container));
  ipcMain.handle(IPC_CHANNELS.profileGet, () => handleProfileGet(container));
  ipcMain.handle(IPC_CHANNELS.profileSave, (_event, input: unknown) => handleProfileSave(container, input));

  // app.getPath("userData")는 app.whenReady() 이전엔 일부 플랫폼에서 값이 없을 수 있어
  // (Electron 문서 권고), 이미 whenReady 이후에만 호출되는 registerIpcHandlers 안에서 계산한다.
  // handlers.ts는 electron을 import하지 않으므로 이 경로는 여기서 만들어 인자로 넘긴다.
  const uiStatePath = join(app.getPath("userData"), "ui-state.json");
  ipcMain.handle(IPC_CHANNELS.uiStateGet, (_event, input: unknown) => handleUiStateGet(uiStatePath, input));
  ipcMain.handle(IPC_CHANNELS.uiStateSet, (_event, input: unknown) => handleUiStateSet(uiStatePath, input));
}
