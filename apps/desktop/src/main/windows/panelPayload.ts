// docs/frontend-plan.md 6.8.2: 결과 패널 내부 채널은 Result<T> 데이터 IPC가 아니라
// 단방향 send라 payload를 그대로 신뢰하지 않는다 — 외부 URL이나 임의 파일 경로를
// 받지 않도록 view는 허용 값만, itemId는 짧은 순수 문자열만 통과시킨다.
export type PanelView = "today" | "calendar" | "inbox" | "ask" | "detail";

const ALLOWED_VIEWS: ReadonlySet<string> = new Set(["today", "calendar", "inbox", "ask", "detail"]);
const MAX_ITEM_ID_LENGTH = 200;

export interface PanelRoute {
  view: PanelView;
  itemId?: string;
}

export function parsePanelRoute(payload: unknown): PanelRoute | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;

  const record = payload as Record<string, unknown>;
  if (typeof record.view !== "string" || !ALLOWED_VIEWS.has(record.view)) return undefined;

  if (record.itemId === undefined) {
    return { view: record.view as PanelView };
  }
  if (
    typeof record.itemId !== "string"
    || record.itemId === ""
    || record.itemId.length > MAX_ITEM_ID_LENGTH
    || /[\r\n]/.test(record.itemId)
  ) {
    return undefined;
  }

  return { view: record.view as PanelView, itemId: record.itemId };
}
