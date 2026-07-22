import { clampPositionToWorkArea, type Point, type Rect, type Size } from "../dragGeometry.ts";

// docs/frontend-plan.md 6.8.2: 패널 창을 캐릭터의 실제 bounds와 모니터 workArea를
// 기준으로 가까운 빈 공간에 배치한다. 좌우에 패널이 들어가면 캐릭터 옆에 두고,
// 좌우가 모두 좁을 때만 위아래 공간을 사용한다.
const DEFAULT_MARGIN = 16;

// clampPositionToWorkArea(dragGeometry.ts)를 재사용해 패널이 workArea보다 크거나
// 구석 좌표가 화면 밖으로 나가는 경우(작은 모니터 등)를 같은 로직으로 방어한다.
export function layoutPanelWindow(
  characterBounds: Rect,
  panelSize: Size,
  workArea: Rect,
  margin = DEFAULT_MARGIN,
): Point {
  const leftSpace = characterBounds.x - workArea.x - margin;
  const rightSpace = workArea.x + workArea.width - characterBounds.x - characterBounds.width - margin;
  const topSpace = characterBounds.y - workArea.y - margin;
  const bottomSpace = workArea.y + workArea.height - characterBounds.y - characterBounds.height - margin;
  const centeredX = Math.round(characterBounds.x + (characterBounds.width - panelSize.width) / 2);
  const centeredY = Math.round(characterBounds.y + (characterBounds.height - panelSize.height) / 2);

  let desired: Point;
  if (leftSpace >= panelSize.width || rightSpace >= panelSize.width) {
    desired = rightSpace >= panelSize.width && rightSpace >= leftSpace
      ? { x: characterBounds.x + characterBounds.width + margin, y: centeredY }
      : { x: characterBounds.x - panelSize.width - margin, y: centeredY };
  } else if (topSpace >= panelSize.height || bottomSpace >= panelSize.height) {
    desired = bottomSpace >= panelSize.height && bottomSpace >= topSpace
      ? { x: centeredX, y: characterBounds.y + characterBounds.height + margin }
      : { x: centeredX, y: characterBounds.y - panelSize.height - margin };
  } else {
    desired = rightSpace >= leftSpace
      ? { x: characterBounds.x + characterBounds.width + margin, y: centeredY }
      : { x: characterBounds.x - panelSize.width - margin, y: centeredY };
  }
  return clampPositionToWorkArea(desired, panelSize, workArea);
}
