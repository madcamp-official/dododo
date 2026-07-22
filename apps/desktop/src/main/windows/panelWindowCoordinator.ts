import type { Point } from "../dragGeometry.ts";
import type { PanelRoute } from "./panelPayload.ts";

// docs/frontend-plan.md 6.8.2: 결과 패널도 설정 창처럼 앱 전체에서 하나만 유지하지만,
// "이미 열려 있으면"의 동작이 다르다 — focus만 하는 게 아니라 route/itemId를 바꿔
// 같은 창 안에서 다른 화면을 보여준다. settingsWindowCoordinator.ts와 같은 이유로
// electron을 import하지 않는 순수 상태 기계로 분리한다.
export interface PanelWindowHandle {
  isDestroyed(): boolean;
  show(): void;
  focus(): void;
  setPosition(position: Point): void;
  navigate(route: PanelRoute): void;
  onClosed(listener: () => void): void;
}

export interface PanelWindowCoordinator {
  // 이미 열려 있고 파괴되지 않았으면 navigate(route) 후 show()/focus()만 하고,
  // 아니면(한 번도 안 열었거나 이전 창이 닫혔으면) createWindow(route)로 새로
  // 만든다. createWindow를 호출 시점에 받는 이유는 캐릭터 위치·workArea 기준
  // 배치가 매번 달라질 수 있어(사용자가 캐릭터를 옮긴 뒤 패널을 처음 여는 경우)
  // 생성 시점의 최신 배치 정보로 만들어야 하기 때문이다.
  open(route: PanelRoute, position: Point, createWindow: (route: PanelRoute) => PanelWindowHandle): void;
}

export function createPanelWindowCoordinator(): PanelWindowCoordinator {
  let current: PanelWindowHandle | undefined;

  return {
    open(route, position, createWindow): void {
      if (current !== undefined && !current.isDestroyed()) {
        current.setPosition(position);
        current.navigate(route);
        current.show();
        current.focus();
        return;
      }

      const window = createWindow(route);
      window.setPosition(position);
      window.onClosed(() => {
        if (current === window) current = undefined;
      });
      current = window;
      window.show();
    },
  };
}
