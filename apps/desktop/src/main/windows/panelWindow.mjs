import { BrowserWindow } from "electron";

import { createPanelWindowCoordinator } from "./panelWindowCoordinator.ts";
import { buildPanelWindowOptions, PANEL_SIZE } from "./panelWindowOptions.ts";
import { layoutPanelWindow } from "./panelPlacement.ts";

export const PANEL_NAVIGATE_CHANNEL = "panel:navigate";

// docs/frontend-plan.md 6.8.2: 실제 BrowserWindow 생성·배치·로드만 담당하고,
// singleton/route 판단은 electron 없이 테스트한 panelWindowCoordinator.ts가 맡는다
// (settingsWindow.mjs와 같은 분리 방식).
export function createOpenPanel({ preloadPath, rendererPath }) {
  const coordinator = createPanelWindowCoordinator();

  return function openPanel(route, layout) {
    coordinator.open(route, (initialRoute) => {
      const position = layoutPanelWindow(layout.characterPlacement, PANEL_SIZE, layout.workArea);
      const window = new BrowserWindow({
        ...buildPanelWindowOptions(preloadPath),
        x: position.x,
        y: position.y,
      });
      window.setMenuBarVisibility(false);
      // Renderer가 PANEL_NAVIGATE_CHANNEL 리스너를 등록할 시간을 주기 위해
      // 로드가 끝난 뒤에만 첫 route를 보낸다 — 그 전에 보내면 유실된다.
      window.webContents.once("did-finish-load", () => {
        window.webContents.send(PANEL_NAVIGATE_CHANNEL, initialRoute);
      });
      void window.loadFile(rendererPath).catch((error) => {
        console.error("DoDoDo 패널 창 Renderer를 열지 못했습니다.", error);
      });

      return {
        isDestroyed: () => window.isDestroyed(),
        show: () => window.show(),
        focus: () => window.focus(),
        navigate: (nextRoute) => window.webContents.send(PANEL_NAVIGATE_CHANNEL, nextRoute),
        onClosed: (listener) => window.on("closed", listener),
      };
    });
  };
}
