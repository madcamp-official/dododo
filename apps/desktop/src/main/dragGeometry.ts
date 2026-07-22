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

export type CharacterPlacement = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export interface CharacterWindowLayout {
  windowPosition: Point;
  characterPosition: Point;
  placement: CharacterPlacement;
}

export function layoutWindowForCharacter(
  desiredCharacterPosition: Point,
  windowSize: Size,
  characterSize: Size,
  workArea: Rect,
  margin = 4,
  previousPlacement?: CharacterPlacement,
  placementHysteresis = 48,
): CharacterWindowLayout {
  const characterPosition = clampPositionToWorkArea(desiredCharacterPosition, characterSize, workArea);
  const centerX = characterPosition.x + characterSize.width / 2;
  const centerY = characterPosition.y + characterSize.height / 2;
  const middleX = workArea.x + workArea.width / 2;
  const middleY = workArea.y + workArea.height / 2;
  const wasLeft = previousPlacement?.endsWith("left");
  const wasTop = previousPlacement?.startsWith("top");
  const onLeft = previousPlacement === undefined
    ? centerX < middleX
    : wasLeft ? centerX < middleX + placementHysteresis : centerX < middleX - placementHysteresis;
  const onTop = previousPlacement === undefined
    ? centerY < middleY
    : wasTop ? centerY < middleY + placementHysteresis : centerY < middleY - placementHysteresis;
  const placement: CharacterPlacement = `${onTop ? "top" : "bottom"}-${onLeft ? "left" : "right"}`;
  const offsetX = onLeft ? margin : windowSize.width - characterSize.width - margin;
  const offsetY = onTop ? margin : windowSize.height - characterSize.height - margin;
  return {
    placement,
    characterPosition,
    windowPosition: { x: characterPosition.x - offsetX, y: characterPosition.y - offsetY },
  };
}
