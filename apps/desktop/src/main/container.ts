import { createCliContainer, type CliContainer } from "../../../cli/src/runtime/container.ts";

// Electron Main은 창을 여러 개 띄워도 프로세스 자체는 하나이므로, CLI처럼 명령마다 새
// container를 만들지 않고 앱 생명주기 동안 하나만 만들어 재사용한다(SQLite 커넥션을
// 매 IPC 호출마다 열고 닫지 않기 위함).
let cached: CliContainer | undefined;

export function getDesktopContainer(): CliContainer {
  if (cached === undefined) cached = createCliContainer();
  return cached;
}

export function closeDesktopContainer(): void {
  if (cached === undefined) return;
  cached.close();
  cached = undefined;
}
