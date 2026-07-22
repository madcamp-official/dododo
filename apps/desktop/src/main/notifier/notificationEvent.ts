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
  | "distraction"
  // docs/llm-architecture.md §5 Job Queue: extract_facts 같은 백그라운드 재분석
  // 작업이 재시도 한도를 다 써 dead_letter로 넘어가면 발생한다(watchTick.ts의
  // WatchTickResult.deadLetteredJobs → jobFailureSummary.ts).
  | "job-failed";

export interface NotificationEvent {
  kind: NotificationKind;
  message: string;
  contextItemId?: string;
  createdAt: string;
}

export const NOTIFICATION_CHANNEL = "notification";
