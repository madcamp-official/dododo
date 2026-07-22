// docs/frontend-plan.md 6.7: 설정 창은 앱 전체에서 하나만 유지한다 — 이미 열려
// 있으면 새 창을 만들지 않고 show()/focus()만 하고, 닫힌 뒤에는 참조를 정리해
// 다시 열 수 있게 한다. 이 판단 자체(지금 창을 새로 만들지, 기존 창에 focus만
// 할지)는 실제 BrowserWindow 없이도 테스트할 수 있는 순수 상태 기계라 electron을
// import하지 않는 이 파일로 분리한다 — captureScheduler.ts/studySession.ts와 같은
// "로직은 여기, electron 배선은 windows/settingsWindow.mjs에" 분리 방식이다.
export interface SettingsWindowHandle {
  isDestroyed(): boolean;
  show(): void;
  focus(): void;
  onClosed(listener: () => void): void;
}

export interface SettingsWindowCoordinator {
  // 이미 열려 있고 파괴되지 않았으면 focus만 하고, 아니면(한 번도 안 열었거나
  // 이전 창이 닫혔으면) createWindow()로 새로 만든다.
  open(): void;
}

export function createSettingsWindowCoordinator(
  createWindow: () => SettingsWindowHandle,
): SettingsWindowCoordinator {
  let current: SettingsWindowHandle | undefined;

  return {
    open(): void {
      if (current !== undefined && !current.isDestroyed()) {
        current.show();
        current.focus();
        return;
      }

      const window = createWindow();
      window.onClosed(() => {
        // 이 창이 나중에(다른 창이 이미 새로 만들어진 뒤) 닫히는 경우는 없다 —
        // open()이 기존 창을 재사용하지 새로 만들지 않으므로 current는 항상 이
        // window와 같다. 그래도 방어적으로 같은 인스턴스일 때만 지운다.
        if (current === window) current = undefined;
      });
      current = window;
      window.show();
    },
  };
}
