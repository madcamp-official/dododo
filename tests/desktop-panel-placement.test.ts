import assert from "node:assert/strict";
import test from "node:test";

import { layoutPanelWindow } from "../apps/desktop/src/main/windows/panelPlacement.ts";

const WORK_AREA = { x: 0, y: 0, width: 1920, height: 1080 };
const PANEL_SIZE = { width: 460, height: 420 };

test("오른쪽 캐릭터의 바로 왼쪽에 패널을 놓는다", () => {
  const character = { x: 1700, y: 700, width: 174, height: 174 };
  const position = layoutPanelWindow(character, PANEL_SIZE, WORK_AREA, 16);
  assert.equal(position.x, character.x - PANEL_SIZE.width - 16);
  assert.equal(position.y, character.y + (character.height - PANEL_SIZE.height) / 2);
});

test("왼쪽 캐릭터의 바로 오른쪽에 패널을 놓는다", () => {
  const character = { x: 40, y: 100, width: 174, height: 174 };
  const position = layoutPanelWindow(character, PANEL_SIZE, WORK_AREA, 16);
  assert.equal(position.x, character.x + character.width + 16);
  assert.equal(position.y, WORK_AREA.y);
});

test("좌우 공간이 부족하면 캐릭터 아래의 빈 공간을 사용한다", () => {
  const narrowArea = { x: 0, y: 0, width: 700, height: 1080 };
  const character = { x: 263, y: 40, width: 174, height: 174 };
  const position = layoutPanelWindow(character, PANEL_SIZE, narrowArea, 16);
  assert.equal(position.x, character.x + (character.width - PANEL_SIZE.width) / 2);
  assert.equal(position.y, character.y + character.height + 16);
});

test("작은 모니터에서도 workArea 밖으로 나가지 않는다", () => {
  const smallWorkArea = { x: 100, y: 50, width: 700, height: 600 };
  const position = layoutPanelWindow({ x: 360, y: 250, width: 174, height: 174 }, PANEL_SIZE, smallWorkArea, 16);
  assert.ok(position.x >= smallWorkArea.x);
  assert.ok(position.x + PANEL_SIZE.width <= smallWorkArea.x + smallWorkArea.width);
  assert.ok(position.y >= smallWorkArea.y);
  assert.ok(position.y + PANEL_SIZE.height <= smallWorkArea.y + smallWorkArea.height);
});
