import assert from "node:assert/strict";
import test from "node:test";

import { clampPositionToWorkArea } from "../apps/desktop/src/main/dragGeometry.ts";

const workArea = { x: 0, y: 0, width: 1000, height: 800 };
const size = { width: 680, height: 420 };

test("clampPositionToWorkArea는 작업 영역 안의 위치를 그대로 둔다", () => {
  assert.deepEqual(clampPositionToWorkArea({ x: 100, y: 100 }, size, workArea), { x: 100, y: 100 });
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
