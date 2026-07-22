import type { DeadLetteredJob } from "../../../../cli/src/runtime/jobQueue/worker.ts";
import type { NotificationEvent } from "../notifier/notificationEvent.ts";

// docs/llm-architecture.md §5: dead_letter는 "더 이상 자동으로 재시도하지 않는
// 영구 실패"다 — 콘솔 로그로만 남으면 데스크톱 사용자는 절대 못 본다(watch가
// 상시 백그라운드로 돈다). tick마다 매번 알리는 대신(dead_letter는 이미 끝난
// 상태라 반복 알림이 의미 없다) watchTick.ts가 "이번 tick에 새로 dead-letter된
// 것"만 넘겨주므로 그대로 한 건씩 알린다(conflictEvents.ts와 같은 방식).
export function toJobFailureEvents(deadLetteredJobs: DeadLetteredJob[], now: Date): NotificationEvent[] {
  // job.inputRef는 RawItem id다(예: extract_facts) — ContextItem id가 아니라서
  // contextItemId로 넣지 않는다. 상세보기로 딥링크할 대상이 아직 없다(추출 자체가
  // 실패해 ContextItem이 생기지 않았을 수 있다).
  return deadLetteredJobs.map((job) => ({
    kind: "job-failed",
    message: `백그라운드 분석 작업이 반복 실패해 재시도를 멈췄습니다(${job.type}).`,
    createdAt: now.toISOString(),
  }));
}
