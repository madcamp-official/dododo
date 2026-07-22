import { clampPositionToWorkArea, type CharacterPlacement, type Point, type Rect, type Size } from "../dragGeometry.ts";

// docs/frontend-plan.md 6.8.2: 패널 창을 캐릭터 위치와 모니터 workArea를 기준으로
// 빈 공간 쪽에 배치한다. 캐릭터가 이미 한쪽 구석(CharacterPlacement)을 차지하고
// 있으므로, 대각선으로 반대쪽 구석에 두는 것이 가장 단순하고 안정적인 "빈 공간"
// 근사다 — 매번 실제 겹침을 픽셀 단위로 계산하지 않아도 된다.
const OPPOSITE_CORNER: Record<CharacterPlacement, CharacterPlacement> = {
  "top-left": "bottom-right",
  "top-right": "bottom-left",
  "bottom-left": "top-right",
  "bottom-right": "top-left",
};

export function oppositeCorner(placement: CharacterPlacement): CharacterPlacement {
  return OPPOSITE_CORNER[placement];
}

const DEFAULT_MARGIN = 16;

// clampPositionToWorkArea(dragGeometry.ts)를 재사용해 패널이 workArea보다 크거나
// 구석 좌표가 화면 밖으로 나가는 경우(작은 모니터 등)를 같은 로직으로 방어한다.
export function layoutPanelWindow(
  characterPlacement: CharacterPlacement,
  panelSize: Size,
  workArea: Rect,
  margin = DEFAULT_MARGIN,
): Point {
  const corner = oppositeCorner(characterPlacement);
  const onLeft = corner.endsWith("left");
  const onTop = corner.startsWith("top");
  const desired: Point = {
    x: onLeft ? workArea.x + margin : workArea.x + workArea.width - panelSize.width - margin,
    y: onTop ? workArea.y + margin : workArea.y + workArea.height - panelSize.height - margin,
  };
  return clampPositionToWorkArea(desired, panelSize, workArea);
}
