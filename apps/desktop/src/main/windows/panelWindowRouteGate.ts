import type { PanelRoute } from "./panelPayload.ts";

// doyeonid 리뷰(PR #97) P1: panelWindow.mjs가 did-finish-load 콜백에서 창을 만들
// 당시의 route(initialRoute)를 클로저로 캡처해 그대로 보냈다. 그 사이(로드가 끝나기
// 전) navigate()가 다시 호출되면(예: openPanel(today) 직후 openPanel(calendar))
// coordinator는 이미 만들어진 창을 재사용한다고 보고 즉시 send를 시도하지만, 아직
// Renderer가 리스너를 등록하기 전이라 그 send는 유실된다 — 결국 로드가 끝났을 때는
// 최신 요청(calendar)이 아니라 stale한 초기 route(today)가 전달된다.
//
// "아직 로드 전이면 최신 값만 기억해 두고, 로드가 끝나는 순간 그 최신 값을 한 번
// 보낸다"는 판단만 담당하는 순수 상태 기계로 분리해 electron 없이 테스트한다.
export interface PanelWindowRouteGate {
  // navigate() 호출 시 항상 최신 route로 갱신한다. ready 상태면 호출부가 그 값을
  // 즉시 전송해야 한다는 뜻으로 true를 반환하고, 아직 로드 전이면 false를 반환해
  // "지금은 보내지 말고 markReady()가 불릴 때 보내라"를 알린다.
  setRoute(route: PanelRoute): { shouldSendNow: boolean };
  // did-finish-load에서 한 번만 호출한다. 그 시점까지의 가장 최신 route를 반환하고,
  // 이후의 setRoute() 호출은 shouldSendNow: true를 반환해 즉시 전송 대상이 된다.
  markReady(): PanelRoute;
}

export function createPanelWindowRouteGate(initialRoute: PanelRoute): PanelWindowRouteGate {
  let pending = initialRoute;
  let ready = false;

  return {
    setRoute(route) {
      pending = route;
      return { shouldSendNow: ready };
    },
    markReady() {
      ready = true;
      return pending;
    },
  };
}
