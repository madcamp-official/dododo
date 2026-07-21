import { createCliContainer, type CliContainer } from "../../../cli/src/runtime/container.ts";
import { ElectronDesktopNotifier } from "./notifier/electronNotifier.ts";

// Electron Main은 CLI와 달리 프로세스 하나가 앱 실행 내내(여러 창·여러 IPC 호출에
// 걸쳐) 계속 산다 — CLI처럼 명령마다 새 container를 만들고 버리지 않는다. 한 번
// 만들어서 app 종료까지 재사용하고, SQLite 커넥션은 quit 시 한 번만 닫는다.
let container: CliContainer | undefined;

export function getDesktopContainer(): CliContainer {
  if (container === undefined) {
    container = createCliContainer();
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
