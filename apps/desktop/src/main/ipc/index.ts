import { ipcMain } from "electron";

import type { CliContainer } from "../../../../cli/src/runtime/container.ts";
import { submitAdd } from "./add.ts";
import { askQuestion } from "./ask.ts";
import { getCalendar, getInbox, getToday } from "./context.ts";
import { fail } from "./result.ts";
import { runSync } from "./sync.ts";
import { completeTask, getTaskDetail, snoozeTask } from "./task.ts";
import { isNonEmptyString, isRecord } from "./validate.ts";

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

  ipcMain.handle(IPC_CHANNELS.askAsk, (_event, input: unknown) => {
    if (!isRecord(input) || typeof input.question !== "string") {
      return fail("validation", "question은 문자열이어야 합니다.");
    }
    return askQuestion(container, input.question);
  });

  ipcMain.handle(IPC_CHANNELS.addSubmit, (_event, input: unknown) => {
    if (
      !isRecord(input)
      || typeof input.title !== "string"
      || typeof input.date !== "string"
      || typeof input.time !== "string"
      || (input.endTime !== undefined && typeof input.endTime !== "string")
      || (input.location !== undefined && typeof input.location !== "string")
      || (input.reminderOffsetMinutes !== undefined && typeof input.reminderOffsetMinutes !== "number")
    ) {
      return fail("validation", "title/date/time은 문자열이어야 하고, 나머지 필드는 형식이 맞아야 합니다.");
    }
    return submitAdd(container, {
      title: input.title,
      date: input.date,
      time: input.time,
      endTime: input.endTime,
      location: input.location,
      reminderOffsetMinutes: input.reminderOffsetMinutes,
    });
  });

  ipcMain.handle(IPC_CHANNELS.taskDetail, (_event, input: unknown) => {
    if (!isRecord(input) || !isNonEmptyString(input.id)) return fail("validation", "id는 문자열이어야 합니다.");
    return getTaskDetail(container, input.id);
  });

  ipcMain.handle(IPC_CHANNELS.taskComplete, (_event, input: unknown) => {
    if (!isRecord(input) || !isNonEmptyString(input.id)) return fail("validation", "id는 문자열이어야 합니다.");
    return completeTask(container, input.id);
  });

  ipcMain.handle(IPC_CHANNELS.taskSnooze, (_event, input: unknown) => {
    if (!isRecord(input) || !isNonEmptyString(input.id) || typeof input.until !== "string") {
      return fail("validation", "id/until은 문자열이어야 합니다.");
    }
    return snoozeTask(container, input.id, input.until);
  });

  ipcMain.handle(IPC_CHANNELS.syncRun, () => runSync(container));
}
