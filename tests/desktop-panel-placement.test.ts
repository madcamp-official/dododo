import assert from "node:assert/strict";
import test from "node:test";

import { layoutPanelWindow, oppositeCorner } from "../apps/desktop/src/main/windows/panelPlacement.ts";

const WORK_AREA = { x: 0, y: 0, width: 1920, height: 1080 };
const PANEL_SIZE = { width: 460, height: 420 };

test("반대쪽 구석을 정확히 계산한다", () => {
  assert.equal(oppositeCorner("top-left"), "bottom-right");
  assert.equal(oppositeCorner("top-right"), "bottom-left");
  assert.equal(oppositeCorner("bottom-left"), "top-right");
  assert.equal(oppositeCorner("bottom-right"), "top-left");
});

test("캐릭터가 bottom-right면 패널은 top-left 쪽 여백에 놓인다", () => {
  const position = layoutPanelWindow("bottom-right", PANEL_SIZE, WORK_AREA, 16);
  assert.equal(position.x, WORK_AREA.x + 16);
  assert.equal(position.y, WORK_AREA.y + 16);
});

test("캐릭터가 top-left면 패널은 bottom-right 쪽 여백에 놓인다", () => {
  const position = layoutPanelWindow("top-left", PANEL_SIZE, WORK_AREA, 16);
  assert.equal(position.x, WORK_AREA.x + WORK_AREA.width - PANEL_SIZE.width - 16);
  assert.equal(position.y, WORK_AREA.y + WORK_AREA.height - PANEL_SIZE.height - 16);
});

test("작은 모니터에서도 workArea 밖으로 나가지 않는다", () => {
  const smallWorkArea = { x: 100, y: 50, width: 700, height: 600 };
  const position = layoutPanelWindow("bottom-right", PANEL_SIZE, smallWorkArea, 16);
  assert.ok(position.x >= smallWorkArea.x);
  assert.ok(position.x + PANEL_SIZE.width <= smallWorkArea.x + smallWorkArea.width);
  assert.ok(position.y >= smallWorkArea.y);
  assert.ok(position.y + PANEL_SIZE.height <= smallWorkArea.y + smallWorkArea.height);
});
