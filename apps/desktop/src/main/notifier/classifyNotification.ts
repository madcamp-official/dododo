import { isReminderRecommendationId } from "../../../../cli/src/runtime/reminderCheck.ts";
import type { ContextItem, Recommendation } from "../../../../../packages/shared/src/index.ts";
import type { NotificationEvent } from "./notificationEvent.ts";

// Recommendation은 어떤 종류의 ContextItem을 가리키는지 자체적으로 담지 않는다 —
// 대상 item.kind를 봐야 알 수 있다(opportunity). 리마인더는 예외로, watchTick.ts가
// reminderCheck.ts의 toReminderRecommendation으로 만든 합성 Recommendation이라
// id 접두사("reminder-")로 바로 구분한다(item 조회 불필요). opportunity(조용한 알림)/
// reminder(즉시 알림)는 UI 표현만 다르고 Main 쪽 라우팅(IPC push, OS 토스트 생략)은
// 같다 — Renderer가 event.kind로 배지/말풍선을 구분한다(docs/frontend-plan.md 6.2).
// priority/conflict/advice/distraction은 아직 이 경로로 안 들어와(2.1/2.5 백엔드
// 미완) undefined를 반환해 IPC push 대상에서 제외한다 — 잘못된 kind로 단정 짓지 않는다.
export function classifyRecommendation(
  item: ContextItem | undefined,
  recommendation: Recommendation,
): NotificationEvent | undefined {
  if (isReminderRecommendationId(recommendation.id)) {
    return {
      kind: "reminder",
      message: recommendation.reason,
      contextItemId: recommendation.contextItemId,
      createdAt: recommendation.createdAt,
    };
  }

  if (item?.kind !== "opportunity") return undefined;

  return {
    kind: "opportunity",
    message: recommendation.reason,
    contextItemId: recommendation.contextItemId,
    createdAt: recommendation.createdAt,
  };
}
