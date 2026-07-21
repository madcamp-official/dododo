import type { ContextItem, Recommendation } from "../../../../../packages/shared/src/index.ts";
import type { NotificationEvent } from "./notificationEvent.ts";

// Recommendation은 어떤 종류의 ContextItem을 가리키는지 자체적으로 담지 않는다 —
// 대상 item.kind를 봐야 알 수 있다. 지금은 opportunity만 "조용한 알림"으로 분류해
// Renderer에 push한다(docs/frontend-plan.md 6.2). task/event 추천은 여전히
// container.notifier.send()를 통해 알림이 가지만(OS Notification), priority/
// conflict/reminder로 정확히 분류할 근거(2.1/2.4 백엔드)가 아직 없어 이 함수는
// undefined를 반환해 IPC push 대상에서 제외한다 — 잘못된 kind로 단정 짓지 않는다.
export function classifyRecommendation(
  item: ContextItem | undefined,
  recommendation: Recommendation,
): NotificationEvent | undefined {
  if (item?.kind !== "opportunity") return undefined;

  return {
    kind: "opportunity",
    message: recommendation.reason,
    contextItemId: recommendation.contextItemId,
    createdAt: recommendation.createdAt,
  };
}
