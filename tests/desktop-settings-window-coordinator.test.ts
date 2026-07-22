import assert from "node:assert/strict";
import test from "node:test";

import {
  createSettingsWindowCoordinator,
  type SettingsWindowHandle,
} from "../apps/desktop/src/main/windows/settingsWindowCoordinator.ts";

function fakeWindow() {
  let destroyed = false;
  let closedListener: (() => void) | undefined;
  const calls: string[] = [];
  const handle: SettingsWindowHandle = {
    isDestroyed: () => destroyed,
    show: () => calls.push("show"),
    focus: () => calls.push("focus"),
    onClosed: (listener) => {
      closedListener = listener;
    },
  };
  return {
    handle,
    calls,
    destroy: () => {
      destroyed = true;
      closedListener?.();
    },
  };
}

test("한 번도 연 적 없으면 createWindow로 새 창을 만들고 보여준다", () => {
  const window = fakeWindow();
  let createCount = 0;
  const coordinator = createSettingsWindowCoordinator(() => {
    createCount += 1;
    return window.handle;
  });

  coordinator.open();

  assert.equal(createCount, 1);
  assert.deepEqual(window.calls, ["show"]);
});

test("이미 열려 있으면 새로 만들지 않고 show·focus만 한다", () => {
  const window = fakeWindow();
  let createCount = 0;
  const coordinator = createSettingsWindowCoordinator(() => {
    createCount += 1;
    return window.handle;
  });

  coordinator.open();
  coordinator.open();
  coordinator.open();

  assert.equal(createCount, 1);
  assert.deepEqual(window.calls, ["show", "show", "focus", "show", "focus"]);
});

test("닫힌 뒤에는 다시 open()하면 새 창을 만든다", () => {
  const first = fakeWindow();
  const second = fakeWindow();
  const windows = [first, second];
  let createCount = 0;
  const coordinator = createSettingsWindowCoordinator(() => {
    createCount += 1;
    return windows[createCount - 1]!.handle;
  });

  coordinator.open();
  first.destroy(); // 사용자가 창을 닫음 — "closed" 이벤트 발생
  coordinator.open();

  assert.equal(createCount, 2);
  assert.deepEqual(second.calls, ["show"]);
});

test("closed 이벤트 없이 isDestroyed()만 true여도 새로 만든다(방어적 확인)", () => {
  const first = fakeWindow();
  const second = fakeWindow();
  const windows = [first, second];
  let createCount = 0;
  const coordinator = createSettingsWindowCoordinator(() => {
    createCount += 1;
    return windows[createCount - 1]!.handle;
  });

  coordinator.open();
  // onClosed 콜백을 부르지 않고 destroyed 상태만 흉내낸다.
  first.handle.isDestroyed = () => true;
  coordinator.open();

  assert.equal(createCount, 2);
});
