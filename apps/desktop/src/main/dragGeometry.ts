export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// index.mjs(Electron 의존)에서 분리한 순수 함수다 — 다른 ipc/*.ts 순수 로직과 같은
// 이유로, electron 없이 node --test로 직접 검증할 수 있게 한다.
export function clampPositionToWorkArea(desired: Point, size: Size, workArea: Rect): Point {
  return {
    x: Math.min(Math.max(desired.x, workArea.x), workArea.x + workArea.width - size.width),
    y: Math.min(Math.max(desired.y, workArea.y), workArea.y + workArea.height - size.height),
  };
}
