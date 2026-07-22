import assert from "node:assert/strict";
import test from "node:test";

import {
  createPanelWindowCoordinator,
  type PanelWindowHandle,
} from "../apps/desktop/src/main/windows/panelWindowCoordinator.ts";
import type { PanelRoute } from "../apps/desktop/src/main/windows/panelPayload.ts";

function fakeWindow() {
  let destroyed = false;
  let closedListener: (() => void) | undefined;
  const calls: string[] = [];
  const routes: PanelRoute[] = [];
  const handle: PanelWindowHandle = {
    isDestroyed: () => destroyed,
    show: () => calls.push("show"),
    focus: () => calls.push("focus"),
    navigate: (route) => {
      calls.push("navigate");
      routes.push(route);
    },
    onClosed: (listener) => {
      closedListener = listener;
    },
  };
  return {
    handle,
    calls,
    routes,
    destroy: () => {
      destroyed = true;
      closedListener?.();
    },
  };
}

test("한 번도 연 적 없으면 createWindow로 새 창을 만들고 초기 route로 보여준다", () => {
  const window = fakeWindow();
  let createCount = 0;
  let receivedRoute: PanelRoute | undefined;
  const coordinator = createPanelWindowCoordinator();

  coordinator.open({ view: "today" }, (route) => {
    createCount += 1;
    receivedRoute = route;
    return window.handle;
  });

  assert.equal(createCount, 1);
  assert.deepEqual(receivedRoute, { view: "today" });
  assert.deepEqual(window.calls, ["show"]);
});

test("이미 열려 있으면 새로 만들지 않고 navigate 후 show·focus한다", () => {
  const window = fakeWindow();
  let createCount = 0;
  const coordinator = createPanelWindowCoordinator();
  const createWindow = () => {
    createCount += 1;
    return window.handle;
  };

  coordinator.open({ view: "today" }, createWindow);
  coordinator.open({ view: "detail", itemId: "task-1" }, createWindow);

  assert.equal(createCount, 1);
  assert.deepEqual(window.calls, ["show", "navigate", "show", "focus"]);
  assert.deepEqual(window.routes, [{ view: "detail", itemId: "task-1" }]);
});

test("닫힌 뒤에는 다시 open()하면 새 창을 만든다", () => {
  const first = fakeWindow();
  const second = fakeWindow();
  const windows = [first, second];
  let createCount = 0;
  const coordinator = createPanelWindowCoordinator();
  const createWindow = () => {
    createCount += 1;
    return windows[createCount - 1]!.handle;
  };

  coordinator.open({ view: "today" }, createWindow);
  first.destroy();
  coordinator.open({ view: "calendar" }, createWindow);

  assert.equal(createCount, 2);
  assert.deepEqual(second.calls, ["show"]);
});

test("closed 이벤트 없이 isDestroyed()만 true여도 새로 만든다(방어적 확인)", () => {
  const first = fakeWindow();
  const second = fakeWindow();
  const windows = [first, second];
  let createCount = 0;
  const coordinator = createPanelWindowCoordinator();
  const createWindow = () => {
    createCount += 1;
    return windows[createCount - 1]!.handle;
  };

  coordinator.open({ view: "today" }, createWindow);
  first.handle.isDestroyed = () => true;
  coordinator.open({ view: "inbox" }, createWindow);

  assert.equal(createCount, 2);
});
