import { isReminderRecommendationId } from "../../../../cli/src/runtime/reminderCheck.ts";
import type { ContextItem, Recommendation } from "../../../../../packages/shared/src/index.ts";
import type { NotificationEvent } from "./notificationEvent.ts";

// Recommendation은 어떤 종류의 ContextItem을 가리키는지 자체적으로 담지 않는다 —
// 대상 item.kind를 봐야 알 수 있다(opportunity). 리마인더는 예외로, watchTick.ts가
// reminderCheck.ts의 toReminderRecommendation으로 만든 합성 Recommendation이라
// id 접두사("reminder-")로 바로 구분한다(item 조회 불필요). opportunity(조용한 알림)/
// reminder(즉시 알림)는 UI 표현만 다르고 Main 쪽 라우팅(IPC push, OS 토스트 생략)은
// 같다 — Renderer가 event.kind로 배지/말풍선을 구분한다(docs/frontend-plan.md 6.2).
// 일반 Task/Event 추천과 대상 조회 실패는 priority로 보낸다. Desktop에서는 모든
// 사용자 알림을 캐릭터 말풍선 하나로 통일하므로 분류 실패를 OS 토스트로 우회하지 않는다.
export function classifyRecommendation(
  item: ContextItem | undefined,
  recommendation: Recommendation,
): NotificationEvent {
  if (isReminderRecommendationId(recommendation.id)) {
    return {
      kind: "reminder",
      message: recommendation.reason,
      contextItemId: recommendation.contextItemId,
      createdAt: recommendation.createdAt,
    };
  }

  const opportunity = item?.kind === "opportunity";
  const message = recommendation.reason.length > 0
    ? opportunity
      ? recommendation.reason
      : `${recommendation.action} — ${recommendation.reason}`
    : recommendation.action;
  return {
    kind: opportunity ? "opportunity" : "priority",
    message,
    contextItemId: recommendation.contextItemId,
    createdAt: recommendation.createdAt,
  };
}
