import { app, ipcMain } from "electron";
import { join } from "node:path";
import type { CliContainer } from "../../../../cli/src/runtime/container.ts";
import type { UserProfile } from "../../../../../packages/shared/src/index.ts";
import { askQuestion, type AskAskRequest } from "./ask.ts";
import { getCalendarWeek } from "./calendar.ts";
import { getInbox } from "./inbox.ts";
import { getProfile, saveProfile } from "./profile.ts";
import { runSyncIpc } from "./sync.ts";
import { getToday } from "./today.ts";
import { getUiState, setUiState } from "./uiState.ts";

// docs/frontend-plan.md §6.1의 조회 전용 채널만 등록한다(Task/Event CRUD·Source 등록·
// 같이 공부하기는 이후 Phase). 여기가 유일하게 electron을 import하는 ipc/ 파일이라
// node --test에서 로직 함수(today.ts 등)만 import하면 electron 런타임 없이도 테스트할
// 수 있다 — 이 파일 자체는 실제 Electron Main 프로세스에서만 실행된다.
export function registerIpcHandlers(container: CliContainer): void {
  ipcMain.handle("today:get", () => getToday(container));
  ipcMain.handle("calendar:get", () => getCalendarWeek(container));
  ipcMain.handle("inbox:get", () => getInbox(container));
  ipcMain.handle("ask:ask", (_event, input: AskAskRequest) => askQuestion(container, input));
  ipcMain.handle("sync:run", () => runSyncIpc(container));
  ipcMain.handle("profile:get", () => getProfile(container));
  ipcMain.handle("profile:save", (_event, profile: UserProfile) => saveProfile(container, profile));

  const uiStatePath = join(app.getPath("userData"), "ui-state.json");
  ipcMain.handle("ui-state:get", (_event, input: { key: string }) => getUiState(uiStatePath, input.key));
  ipcMain.handle(
    "ui-state:set",
    (_event, input: { key: string; value: unknown }) => setUiState(uiStatePath, input.key, input.value),
  );
}
