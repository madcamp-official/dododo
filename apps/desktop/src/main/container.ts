import { app } from "electron";
import { join } from "node:path";

import { createCliContainer, type CliContainer } from "../../../cli/src/runtime/container.ts";
import { ElectronDesktopNotifier } from "./notifier/electronNotifier.ts";

// Electron Main은 CLI와 달리 프로세스 하나가 앱 실행 내내(여러 창·여러 IPC 호출에
// 걸쳐) 계속 산다 — CLI처럼 명령마다 새 container를 만들고 버리지 않는다. 한 번
// 만들어서 app 종료까지 재사용하고, SQLite 커넥션은 quit 시 한 번만 닫는다.
let container: CliContainer | undefined;

export function getDesktopContainer(): CliContainer {
  if (container === undefined) {
    // createCliContainer 기본값(./.dododo/dododo.db)은 현재 작업 디렉터리 상대 경로다.
    // 개발 중엔 항상 저장소 루트에서 실행해 문제없지만, 패키징된 앱은 더블클릭으로
    // 실행되어 cwd가 설치 폴더거나 쓰기 권한이 없을 수 있다 — userData 아래 고정
    // 경로를 명시해 실행할 때마다 DB를 못 찾거나 새로 만드는 문제를 막는다
    // (ui-state.json이 이미 이렇게 하는 것과 동일한 이유, apps/desktop/src/main/ipc/index.ts 참고).
    container = createCliContainer({ databasePath: join(app.getPath("userData"), "dododo.db") });
    // createCliContainer는 기본으로 ConsoleNotifier를 쓴다(CLI 전용) — 데스크톱은
    // Electron Notification/IPC push로 갈아 끼운다. notifier는 CliContainer에서
    // readonly가 아니라 이렇게 교체 가능하다(apps/cli/src/commands/watch.ts의
    // --os-notify가 쓰는 것과 같은 방식).
    container.notifier = new ElectronDesktopNotifier(container.repository);
  }
  return container;
}

export function closeDesktopContainer(): void {
  container?.close();
  container = undefined;
}
