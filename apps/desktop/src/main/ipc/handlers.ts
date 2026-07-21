// ipcMain.handle 등록(electron 의존)과 payload 검증+dispatch(순수 로직)를 분리한다 —
// electron은 이 파일 밖(index.ts)에서만 import해서, 여기 있는 함수들은 node --test로
// 직접 검증할 수 있다(doyeonid 리뷰, PR #60: "Electron 등록 코드와 분리된 payload
// parser/handler를 export해 테스트"). 각 함수는 실제 ipcMain.handle 콜백과 정확히
// 같은 동작을 한다 — index.ts는 이 함수들을 채널에 연결하기만 한다.
import { submitAdd, type AddSubmitInput } from "./add.ts";
import { askQuestion } from "./ask.ts";
import { getCalendar, getInbox, getToday } from "./context.ts";
import { fail } from "./result.ts";
import { runSync } from "./sync.ts";
import { completeTask, getTaskDetail, snoozeTask } from "./task.ts";
import { isNonEmptyString, isRecord } from "./validate.ts";
import type { CliContainer } from "../../../../cli/src/runtime/container.ts";

export function handleToday(container: CliContainer) {
  return getToday(container);
}

export function handleCalendar(container: CliContainer) {
  return getCalendar(container);
}

export function handleInbox(container: CliContainer) {
  return getInbox(container);
}

export function handleAsk(container: CliContainer, input: unknown) {
  if (!isRecord(input) || typeof input.question !== "string") {
    return Promise.resolve(fail("validation", "question은 문자열이어야 합니다."));
  }
  return askQuestion(container, input.question);
}

export function handleAddSubmit(container: CliContainer, input: unknown) {
  if (
    !isRecord(input)
    || typeof input.title !== "string"
    || typeof input.date !== "string"
    || typeof input.time !== "string"
    || (input.endTime !== undefined && typeof input.endTime !== "string")
    || (input.location !== undefined && typeof input.location !== "string")
    || (input.reminderOffsetMinutes !== undefined && typeof input.reminderOffsetMinutes !== "number")
  ) {
    return Promise.resolve(
      fail("validation", "title/date/time은 문자열이어야 하고, 나머지 필드는 형식이 맞아야 합니다."),
    );
  }
  const addInput: AddSubmitInput = {
    title: input.title,
    date: input.date,
    time: input.time,
    endTime: input.endTime,
    location: input.location,
    reminderOffsetMinutes: input.reminderOffsetMinutes,
  };
  return submitAdd(container, addInput);
}

export function handleTaskDetail(container: CliContainer, input: unknown) {
  if (!isRecord(input) || !isNonEmptyString(input.id)) {
    return Promise.resolve(fail("validation", "id는 문자열이어야 합니다."));
  }
  return getTaskDetail(container, input.id);
}

export function handleTaskComplete(container: CliContainer, input: unknown) {
  if (!isRecord(input) || !isNonEmptyString(input.id)) {
    return Promise.resolve(fail("validation", "id는 문자열이어야 합니다."));
  }
  return completeTask(container, input.id);
}

export function handleTaskSnooze(container: CliContainer, input: unknown) {
  if (!isRecord(input) || !isNonEmptyString(input.id) || typeof input.until !== "string") {
    return Promise.resolve(fail("validation", "id/until은 문자열이어야 합니다."));
  }
  return snoozeTask(container, input.id, input.until);
}

export function handleSyncRun(container: CliContainer) {
  return runSync(container);
}
