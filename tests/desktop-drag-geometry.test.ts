import assert from "node:assert/strict";
import test from "node:test";

import { clampPositionToWorkArea, layoutWindowForCharacter } from "../apps/desktop/src/main/dragGeometry.ts";

const workArea = { x: 0, y: 0, width: 1000, height: 800 };
const size = { width: 680, height: 420 };

test("clampPositionToWorkArea는 작업 영역 안의 위치를 그대로 둔다", () => {
  assert.deepEqual(clampPositionToWorkArea({ x: 100, y: 100 }, size, workArea), { x: 100, y: 100 });
});

test("캐릭터는 큰 투명 창 크기와 무관하게 화면 네 모서리까지 이동한다", () => {
  const character = { width: 174, height: 174 };
  const topLeft = layoutWindowForCharacter({ x: 0, y: 0 }, size, character, workArea);
  assert.equal(topLeft.placement, "top-left");
  assert.deepEqual(topLeft.characterPosition, { x: 0, y: 0 });
  assert.deepEqual(topLeft.windowPosition, { x: -4, y: -4 });

  const bottomRight = layoutWindowForCharacter({ x: 999, y: 799 }, size, character, workArea);
  assert.equal(bottomRight.placement, "bottom-right");
  assert.deepEqual(bottomRight.characterPosition, { x: 826, y: 626 });
  assert.deepEqual(bottomRight.windowPosition, { x: 324, y: 384 });
});

test("캐릭터가 오른쪽 위면 창 내부 오른쪽 위에 두어 패널 공간을 왼쪽 아래에 확보한다", () => {
  const layout = layoutWindowForCharacter({ x: 800, y: 20 }, size, { width: 174, height: 174 }, workArea);
  assert.equal(layout.placement, "top-right");
  assert.deepEqual(layout.windowPosition, { x: 298, y: 16 });
});

test("화면 중앙 근처에서는 기존 배치를 유지해 드래그 중 방향이 튕기지 않는다", () => {
  const character = { width: 174, height: 174 };
  const nearCenterFromLeft = layoutWindowForCharacter(
    { x: 430, y: 300 }, size, character, workArea, 4, "top-left",
  );
  assert.equal(nearCenterFromLeft.placement, "top-left");

  const clearlyRight = layoutWindowForCharacter(
    { x: 510, y: 300 }, size, character, workArea, 4, "top-left",
  );
  assert.equal(clearlyRight.placement, "top-right");
});

test("드래그 중에는 화면 반대편까지 가도 기존 창 내부 기준점을 유지한다", () => {
  const layout = layoutWindowForCharacter(
    { x: 800, y: 600 },
    size,
    { width: 174, height: 174 },
    workArea,
    4,
    "top-left",
    Number.POSITIVE_INFINITY,
  );
  assert.equal(layout.placement, "top-left");
  assert.deepEqual(layout.characterPosition, { x: 800, y: 600 });
  assert.deepEqual(layout.windowPosition, { x: 796, y: 596 });
});

test("clampPositionToWorkArea는 작업 영역 왼쪽·위쪽 경계 밖을 안으로 당긴다", () => {
  assert.deepEqual(clampPositionToWorkArea({ x: -50, y: -30 }, size, workArea), { x: 0, y: 0 });
});

test("clampPositionToWorkArea는 작업 영역 오른쪽·아래쪽 경계 밖을 안으로 당긴다", () => {
  assert.deepEqual(
    clampPositionToWorkArea({ x: 900, y: 700 }, size, workArea),
    { x: workArea.width - size.width, y: workArea.height - size.height },
  );
});

test("clampPositionToWorkArea는 여러 모니터의 workArea 원점 오프셋을 반영한다", () => {
  const secondMonitor = { x: 1000, y: 0, width: 1000, height: 800 };
  assert.deepEqual(
    clampPositionToWorkArea({ x: -100, y: 900 }, size, secondMonitor),
    { x: secondMonitor.x, y: secondMonitor.y + secondMonitor.height - size.height },
  );
});
