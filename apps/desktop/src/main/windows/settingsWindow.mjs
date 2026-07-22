import { BrowserWindow } from "electron";

import { createSettingsWindowCoordinator } from "./settingsWindowCoordinator.ts";
import { buildSettingsWindowOptions } from "./settingsWindowOptions.ts";

// docs/frontend-plan.md 6.7: 캐릭터 창(투명·alwaysOnTop·프레임 없음)과 달리 설정
// 창은 일반 프레임의 독립 창이고, 앱 전체에서 하나만 유지한다. 실제 singleton
// 판단(이미 열려 있으면 focus만, 닫혔으면 새로 생성)은 electron 없이도 테스트한
// settingsWindowCoordinator.ts가 맡고, 여기서는 실제 BrowserWindow 생성·로드만
// 담당한다.
export function createOpenSettings({ preloadPath, rendererPath }) {
  const coordinator = createSettingsWindowCoordinator(() => {
    const window = new BrowserWindow(buildSettingsWindowOptions(preloadPath));
    window.setMenuBarVisibility(false);
    void window.loadFile(rendererPath).catch((error) => {
      console.error("DoToRi 설정 창 Renderer를 열지 못했습니다.", error);
    });

    return {
      isDestroyed: () => window.isDestroyed(),
      show: () => window.show(),
      focus: () => window.focus(),
      onClosed: (listener) => window.on("closed", listener),
    };
  });

  return () => coordinator.open();
}
