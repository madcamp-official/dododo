// docs/frontend-plan.md 6.2의 NotificationKind/NotificationEvent 계약을 그대로 옮긴다.
// priority/conflict/reminder/advice/distraction은 아직 값을 만드는 백엔드가 없어
// (2.1/2.4/2.5, Stage 3~5) 타입만 미리 맞춰 두고 이번 Stage에서는 emit하지 않는다.
export type NotificationKind =
  | "priority"
  | "conflict"
  | "reminder"
  | "opportunity"
  | "sync-complete"
  | "advice"
  | "distraction";

export interface NotificationEvent {
  kind: NotificationKind;
  message: string;
  contextItemId?: string;
  createdAt: string;
}

export const NOTIFICATION_CHANNEL = "notification";
