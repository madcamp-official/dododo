import type { SyncResult } from "../../../../../packages/shared/src/index.ts";
import type { NotificationEvent } from "../notifier/notificationEvent.ts";

// tick마다 매번 알리면 아무 변화 없는 5분 주기 폴링까지 배지가 뜬다 — 새로 만들어진
// 항목이 하나라도 있을 때만 "sync-complete" 이벤트를 만든다(조용한 알림, 6.2).
export function summarizeSyncForNotification(
  syncedSources: SyncResult[],
  now: Date,
): NotificationEvent | undefined {
  const created = syncedSources.reduce((sum, source) => sum + source.created, 0);
  if (created === 0) return undefined;

  return {
    kind: "sync-complete",
    message: `새 항목 ${created}건을 확인했습니다.`,
    createdAt: now.toISOString(),
  };
}
