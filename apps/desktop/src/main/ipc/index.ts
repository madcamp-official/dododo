import { app, ipcMain, powerMonitor } from "electron";
import { join } from "node:path";

import type { CliContainer } from "../../../../cli/src/runtime/container.ts";
import {
  handleAddSubmit,
  handleAsk,
  handleCalendar,
  handleInbox,
  handleProfileGet,
  handleProfileSave,
  handleSourceList,
  handleSourceRegister,
  handleSourceRemove,
  handleSyncRun,
  handleTaskComplete,
  handleTaskDelete,
  handleTaskDetail,
  handleTaskSetReminderOffset,
  handleTaskSnooze,
  handleTaskUpdate,
  handleToday,
  handleStudyEnd,
  handleStudyGet,
  handleStudyStart,
  handleUiStateGet,
  handleUiStateSet,
} from "./handlers.ts";
import { StudySessionManager } from "./studySession.ts";
import { createStudyCaptureScheduler } from "../study/captureScheduler.ts";
import { createCaptureSchedulerSync } from "../study/captureSchedulerSync.ts";

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
  taskSetReminderOffset: "task:setReminderOffset",
  sourceList: "source:list",
  sourceRegister: "source:register",
  sourceRemove: "source:remove",
  syncRun: "sync:run",
  profileGet: "profile:get",
  profileSave: "profile:save",
  uiStateGet: "ui-state:get",
  uiStateSet: "ui-state:set",
  studyStart: "study:start",
  studyEnd: "study:end",
  studyGet: "study:get",
} as const;

// payload 검증과 실제 처리는 handlers.ts(electron 미의존, node --test로 검증)에 있다 —
// 여기는 채널 이름을 그 함수에 연결하기만 하는 얇은 배선이다. Main에 앱 컨테이너가
// 이미 생겨 있어야 등록할 수 있다 — index.mjs가 app.whenReady() 이후 container를
// 만든 뒤 이 함수를 한 번만 호출한다.
export function registerIpcHandlers(container: CliContainer): void {
  const userDataPath = app.getPath("userData");
  const studySessions = new StudySessionManager(join(userDataPath, "active-study-session.json"));
  // docs/frontend-plan.md 2.5: 세션이 진행 중일 때만 Idle→Active 캡처 트리거를 돈다
  // (captureScheduler.ts). onTrigger는 실제 캡처+Vision 호출이 아직 없어 지금은
  // 로그만 남긴다 — Vision 추출 PR(#79)이 머지되면 이 자리에서 실제 캡처·분석·
  // adviceCount 증가로 교체한다. 트리거 판정 자체(Idle→Active, 최소 간격)는 이미
  // 완성·테스트됐다(captureTrigger.test.ts/captureScheduler.test.ts).
  const captureScheduler = createStudyCaptureScheduler({
    getIdleSeconds: () => powerMonitor.getSystemIdleTime(),
    onTrigger: (reason, at) => {
      console.log(`[study] capture trigger(${reason}) at ${at.toISOString()} — Vision 연결 대기 중(PR #79)`);
    },
  });
  // 앱이 재시작됐는데 이전 세션이 아직 진행 중으로 복원되면(studySession.ts의 영속화)
  // 그 세션에도 캡처 트리거가 다시 붙어야 한다 — 사용자가 다시 "시작"을 누르지 않아도
  // 세션 진행 중에는 캡처가 동작해야 하기 때문이다.
  //
  // doyeonid 리뷰(PR #92) P1: 이 부팅 시 확인이 study:end보다 늦게 끝나면 이미 끝난
  // 세션에 캡처가 다시 붙을 수 있었다 — captureSchedulerSync가 모든 재확인 호출을
  // 직렬화하고 매번 studySessions.getActive()를 다시 읽으므로, 어느 쪽이 먼저
  // 끝나든 가장 나중에 큐에 들어간 재확인이 최종 상태를 결정한다.
  const captureSchedulerSync = createCaptureSchedulerSync({
    getActive: () => studySessions.getActive(),
    scheduler: captureScheduler,
  });
  void captureSchedulerSync.sync();
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
  ipcMain.handle(
    IPC_CHANNELS.taskSetReminderOffset,
    (_event, input: unknown) => handleTaskSetReminderOffset(container, input),
  );
  ipcMain.handle(IPC_CHANNELS.sourceList, () => handleSourceList());
  ipcMain.handle(IPC_CHANNELS.sourceRegister, (_event, input: unknown) => handleSourceRegister(input));
  ipcMain.handle(IPC_CHANNELS.sourceRemove, (_event, input: unknown) => handleSourceRemove(input));
  ipcMain.handle(IPC_CHANNELS.syncRun, () => handleSyncRun(container));
  ipcMain.handle(IPC_CHANNELS.profileGet, () => handleProfileGet(container));
  ipcMain.handle(IPC_CHANNELS.profileSave, (_event, input: unknown) => handleProfileSave(container, input));
  ipcMain.handle(IPC_CHANNELS.studyStart, async (_event, input: unknown) => {
    const result = await handleStudyStart(studySessions, input);
    // 성공 여부와 무관하게 다시 확인한다 — 실패가 "이미 진행 중"(예: 부팅 복원이 아직
    // 안 끝난 사이의 시도)이었다면 그 자체가 세션이 활성 상태라는 뜻이라 scheduler도
    // 맞춰 켜져 있어야 한다.
    void captureSchedulerSync.sync();
    return result;
  });
  ipcMain.handle(IPC_CHANNELS.studyEnd, async (_event, input: unknown) => {
    const result = await handleStudyEnd(studySessions, input);
    void captureSchedulerSync.sync();
    return result;
  });
  ipcMain.handle(IPC_CHANNELS.studyGet, () => handleStudyGet(studySessions));

  // app.getPath("userData")는 app.whenReady() 이전엔 일부 플랫폼에서 값이 없을 수 있어
  // (Electron 문서 권고), 이미 whenReady 이후에만 호출되는 registerIpcHandlers 안에서 계산한다.
  // handlers.ts는 electron을 import하지 않으므로 이 경로는 여기서 만들어 인자로 넘긴다.
  const uiStatePath = join(userDataPath, "ui-state.json");
  ipcMain.handle(IPC_CHANNELS.uiStateGet, (_event, input: unknown) => handleUiStateGet(uiStatePath, input));
  ipcMain.handle(IPC_CHANNELS.uiStateSet, (_event, input: unknown) => handleUiStateSet(uiStatePath, input));
}
