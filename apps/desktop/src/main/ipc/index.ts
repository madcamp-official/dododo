import { ipcMain } from "electron";

import type { CliContainer } from "../../../../cli/src/runtime/container.ts";
import { submitAdd, type AddSubmitInput } from "./add.ts";
import { askQuestion } from "./ask.ts";
import { getCalendar, getInbox, getToday } from "./context.ts";
import { runSync } from "./sync.ts";
import { completeTask, getTaskDetail, snoozeTask } from "./task.ts";

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
  syncRun: "sync:run",
} as const;

// Main에 앱 컨테이너가 이미 생겨 있어야 등록할 수 있다 — index.mjs가 app.whenReady()
// 이후 container를 만든 뒤 이 함수를 한 번만 호출한다.
export function registerIpcHandlers(container: CliContainer): void {
  ipcMain.handle(IPC_CHANNELS.todayGet, () => getToday(container));
  ipcMain.handle(IPC_CHANNELS.calendarGet, () => getCalendar(container));
  ipcMain.handle(IPC_CHANNELS.inboxGet, () => getInbox(container));

  ipcMain.handle(IPC_CHANNELS.askAsk, (_event, input: { question: string }) =>
    askQuestion(container, input.question));

  ipcMain.handle(IPC_CHANNELS.addSubmit, (_event, input: AddSubmitInput) =>
    submitAdd(container, input));

  ipcMain.handle(IPC_CHANNELS.taskDetail, (_event, input: { id: string }) =>
    getTaskDetail(container, input.id));

  ipcMain.handle(IPC_CHANNELS.taskComplete, (_event, input: { id: string }) =>
    completeTask(container, input.id));

  ipcMain.handle(IPC_CHANNELS.taskSnooze, (_event, input: { id: string; until: string }) =>
    snoozeTask(container, input.id, input.until));

  ipcMain.handle(IPC_CHANNELS.syncRun, () => runSync(container));
}
