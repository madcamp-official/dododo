// ipcMain.handle 등록(electron 의존)과 payload 검증+dispatch(순수 로직)를 분리한다 —
// electron은 이 파일 밖(index.ts)에서만 import해서, 여기 있는 함수들은 node --test로
// 직접 검증할 수 있다(doyeonid 리뷰, PR #60: "Electron 등록 코드와 분리된 payload
// parser/handler를 export해 테스트"). 각 함수는 실제 ipcMain.handle 콜백과 정확히
// 같은 동작을 한다 — index.ts는 이 함수들을 채널에 연결하기만 한다.
import { submitAdd, type AddSubmitInput } from "./add.ts";
import { askQuestion } from "./ask.ts";
import { getCalendar, getInbox, getToday } from "./context.ts";
import { getProfile, saveProfile } from "./profile.ts";
import { fail } from "./result.ts";
import { listSources, registerSource, removeSource } from "./source.ts";
import { listSchoolSiteItems } from "./sourceItems.ts";
import { runSync } from "./sync.ts";
import {
  deleteScheduleItem,
  setReminderOffset,
  updateScheduleItem,
  type ScheduleItemUpdateInput,
} from "./scheduleItem.ts";
import { completeTask, getTaskDetail, snoozeTask } from "./task.ts";
import { getUiState, setUiState } from "./uiState.ts";
import { StudySessionManager } from "./studySession.ts";
import { isNonEmptyString, isRecord, isUserProfileShape, isValidOffsetMinutes } from "./validate.ts";
import type { CliContainer } from "../../../../cli/src/runtime/container.ts";
import { isRegisteredSourceType } from "../../../../cli/src/runtime/sourceRegistration.ts";

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

export function handleTaskUpdate(container: CliContainer, input: unknown) {
  if (
    !isRecord(input)
    || !isNonEmptyString(input.id)
    || typeof input.title !== "string"
    || typeof input.date !== "string"
    || typeof input.time !== "string"
    || (input.endTime !== undefined && typeof input.endTime !== "string")
    || (input.location !== undefined && typeof input.location !== "string")
  ) {
    return Promise.resolve(
      fail("validation", "id/title/date/time은 문자열이어야 하고, 나머지 필드는 형식이 맞아야 합니다."),
    );
  }
  const update: ScheduleItemUpdateInput = {
    title: input.title,
    date: input.date,
    time: input.time,
    endTime: input.endTime,
    location: input.location,
  };
  return updateScheduleItem(container, input.id, update);
}

export function handleTaskDelete(container: CliContainer, input: unknown) {
  if (!isRecord(input) || !isNonEmptyString(input.id)) {
    return Promise.resolve(fail("validation", "id는 문자열이어야 합니다."));
  }
  return deleteScheduleItem(container, input.id);
}

export function handleTaskSetReminderOffset(container: CliContainer, input: unknown) {
  if (!isRecord(input) || !isNonEmptyString(input.id) || !isValidOffsetMinutes(input.offsetMinutes)) {
    return Promise.resolve(fail("validation", "id는 문자열, offsetMinutes는 0 이상의 정수(분)여야 합니다."));
  }
  return setReminderOffset(container, input.id, input.offsetMinutes);
}

export function handleSourceList() {
  return listSources();
}

export function handleSourceItems(container: CliContainer) {
  return listSchoolSiteItems(container);
}

export function handleSourceRegister(input: unknown) {
  if (!isRecord(input) || !isRegisteredSourceType(input.type) || typeof input.value !== "string") {
    return Promise.resolve(
      fail("validation", "type은 school-site/school-email/lms 중 하나, value는 문자열이어야 합니다."),
    );
  }
  return registerSource({ type: input.type, value: input.value });
}

export function handleSourceRemove(input: unknown) {
  if (!isRecord(input) || !isRegisteredSourceType(input.id)) {
    return Promise.resolve(fail("validation", "id는 school-site/school-email/lms 중 하나여야 합니다."));
  }
  return removeSource(input.id);
}

export function handleSyncRun(container: CliContainer) {
  return runSync(container);
}

export function handleProfileGet(container: CliContainer) {
  return getProfile(container);
}

export function handleProfileSave(container: CliContainer, input: unknown) {
  if (!isUserProfileShape(input)) {
    return Promise.resolve(fail("validation", "profile 형식이 올바르지 않습니다."));
  }
  return saveProfile(container, input);
}

// uiState는 container가 필요 없고 대신 저장 파일 경로가 필요하다 — index.ts가
// app.getPath("userData")로 계산한 경로를 등록 시점에 주입한다(uiState.ts 참고,
// electron 미의존 유지).
export function handleUiStateGet(uiStatePath: string, input: unknown) {
  if (!isRecord(input) || !isNonEmptyString(input.key)) {
    return Promise.resolve(fail("validation", "key는 문자열이어야 합니다."));
  }
  return getUiState(uiStatePath, input.key);
}

export function handleUiStateSet(uiStatePath: string, input: unknown) {
  if (!isRecord(input) || !isNonEmptyString(input.key) || !("value" in input)) {
    return Promise.resolve(fail("validation", "key/value가 필요합니다."));
  }
  return setUiState(uiStatePath, input.key, input.value);
}

export function handleStudyStart(manager: StudySessionManager, input: unknown) {
  if (!isRecord(input) || typeof input.screenCaptureConsent !== "boolean") {
    return Promise.resolve(fail("validation", "screenCaptureConsent는 boolean이어야 합니다."));
  }
  return manager.start(input.screenCaptureConsent).catch(toStudyStorageFailure);
}

export function handleStudyEnd(manager: StudySessionManager, input: unknown) {
  if (!isRecord(input) || !isNonEmptyString(input.sessionId)) {
    return Promise.resolve(fail("validation", "sessionId는 문자열이어야 합니다."));
  }
  return manager.end(input.sessionId).catch(toStudyStorageFailure);
}

export function handleStudyGet(manager: StudySessionManager) {
  return manager.getActive().catch(toStudyStorageFailure);
}

function toStudyStorageFailure(error: unknown) {
  const detail = error instanceof Error ? error.message : String(error);
  return fail("unknown", `같이 공부하기 세션 상태를 저장하거나 불러오지 못했습니다: ${detail}`);
}
