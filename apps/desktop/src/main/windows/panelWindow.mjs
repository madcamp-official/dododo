import { BrowserWindow } from "electron";

import { createPanelWindowCoordinator } from "./panelWindowCoordinator.ts";
import { buildPanelWindowOptions, PANEL_SIZE } from "./panelWindowOptions.ts";
import { layoutPanelWindow } from "./panelPlacement.ts";
import { createPanelWindowRouteGate } from "./panelWindowRouteGate.ts";

export const PANEL_NAVIGATE_CHANNEL = "panel:navigate";

// docs/frontend-plan.md 6.8.2: 실제 BrowserWindow 생성·배치·로드만 담당하고,
// singleton/route 판단은 electron 없이 테스트한 panelWindowCoordinator.ts가 맡는다
// (settingsWindow.mjs와 같은 분리 방식).
export function createOpenPanel({ preloadPath, rendererPath }) {
  const coordinator = createPanelWindowCoordinator();

  return function openPanel(route, layout) {
    const position = layoutPanelWindow(layout.characterBounds, PANEL_SIZE, layout.workArea);
    coordinator.open(route, position, PANEL_SIZE, (initialRoute) => {
      const window = new BrowserWindow({
        ...buildPanelWindowOptions(preloadPath),
        x: position.x,
        y: position.y,
      });
      window.setMenuBarVisibility(false);

      // doyeonid 리뷰(PR #97) P1: 로드가 끝나기 전에 navigate()가 다시 호출되면
      // (예: openPanel(today) 직후 openPanel(calendar)) 그 즉시 send는 Renderer
      // 리스너 등록 전이라 유실되고, did-finish-load가 클로저로 캡처한 stale한
      // initialRoute(today)만 전달됐다 — routeGate가 "아직 로드 전이면 최신 값만
      // 기억해 두고 ready 시점에 그 최신 값을 보낸다"를 보장한다.
      const routeGate = createPanelWindowRouteGate(initialRoute);
      window.webContents.once("did-finish-load", () => {
        window.webContents.send(PANEL_NAVIGATE_CHANNEL, routeGate.markReady());
      });
      void window.loadFile(rendererPath).catch((error) => {
        console.error("DoDoDo 패널 창 Renderer를 열지 못했습니다.", error);
      });

      return {
        isDestroyed: () => window.isDestroyed(),
        show: () => window.show(),
        focus: () => window.focus(),
        setBounds: (nextPosition, size) => window.setBounds({
          x: nextPosition.x,
          y: nextPosition.y,
          width: size.width,
          height: size.height,
        }),
        navigate: (nextRoute) => {
          const { shouldSendNow } = routeGate.setRoute(nextRoute);
          if (shouldSendNow) window.webContents.send(PANEL_NAVIGATE_CHANNEL, nextRoute);
        },
        onClosed: (listener) => window.on("closed", listener),
      };
    });
  };
}
