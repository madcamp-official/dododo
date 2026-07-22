import { gateNotification, isWithinQuietHours } from "../../../../packages/scheduler/src/index.ts";
import type { Recommendation, SyncResult } from "../../../../packages/shared/src/index.ts";
import { findDueReminders, markReminderSent, toReminderRecommendation } from "./reminderCheck.ts";
import { checkScheduleConflicts, type ScheduleConflict } from "./scheduleConflict.ts";
import { emptyProfile, type CliContainer } from "./container.ts";
import { syncIncrementally } from "./incrementalSync.ts";
import { isSnoozed } from "./snooze.ts";

export interface WatchTickResult {
  syncedSources: SyncResult[];
  // 일반 추천과 마감 리마인더(reminderCheck.ts의 toReminderRecommendation으로 만든
  // Recommendation, id가 "reminder-"로 시작)가 함께 담긴다 — 둘 다 같은
  // gateNotification → notifier.send 파이프라인을 거치므로 반환 shape을 통일했다.
  notified: Recommendation[];
  heldForQuietHours: Recommendation[];
  // docs/frontend-plan.md 2.1 — 이번 tick에서 새로 감지된 일정 충돌만 담는다(이미
  // 알린 쌍은 checkScheduleConflicts가 걸러낸다).
  newConflicts: ScheduleConflict[];
  // Desktop Main이 직접 만드는 sync-complete/conflict IPC 이벤트도 추천·리마인더와
  // 같은 Quiet Hours 정책을 적용할 수 있도록 tick 판정 결과를 전달한다.
  withinQuietHours: boolean;
}

// docs/architecture.md §3 Watch Process 흐름 한 번(수집 스케줄 확인 → 동기화 →
// 알림 후보 계산 → 정책 통과 알림 전송)을 수행한다. 루프/타이머는 watchLoop.ts가
// 감싸며, 이 함수 자체는 순수하게 "한 번" 실행만 책임져 테스트하기 쉽다.
export async function runWatchTick(container: CliContainer, now: Date): Promise<WatchTickResult> {
  // doyeonid 리뷰(PR #61): 데스크톱은 watch tick과 수동 sync:run이 같은 container를
  // 공유해 동시에 실행될 수 있다 — syncLock으로 "동기화 한 번"을 직렬화해 같은
  // RawItem을 양쪽이 동시에 변경 대상으로 판단하지 않게 한다.
  const syncedSources = await container.syncLock.run(async () => {
    const results: SyncResult[] = [];
    for (const collector of container.collectors) {
      const result = await syncIncrementally(collector, container.pipeline, container.rawItemRepository);
      container.syncStatus.record(result, now);
      results.push(result);
    }
    return results;
  });

  const tasks = await container.repository.listContextItems("task");
  const events = await container.repository.listContextItems("event");
  const opportunities = await container.repository.listContextItems("opportunity");
  const items = [...tasks, ...events, ...opportunities];
  const itemsById = new Map(items.map((item) => [item.id, item]));

  const profile = (await container.profileRepository.get()) ?? emptyProfile();
  const withinQuietHours = isWithinQuietHours(profile, now);
  const conflictCheck = checkScheduleConflicts([...tasks, ...events], now);
  // Quiet Hours 중에는 충돌 알림 완료 메타데이터를 커밋하지 않는다. 그래야 종료 후
  // 다음 tick이 같은 충돌을 다시 감지해 실제로 전달할 수 있다.
  if (!withinQuietHours && conflictCheck.updatedItems.length > 0) {
    await container.repository.saveContextItems(conflictCheck.updatedItems);
  }
  const recommendations = await container.recommendationEngine.recommend(items, profile, now);

  const notified: Recommendation[] = [];
  const heldForQuietHours: Recommendation[] = [];

  for (const recommendation of recommendations) {
    const item = itemsById.get(recommendation.contextItemId);
    if (item === undefined || isSnoozed(item, now)) continue;

    const gated = gateNotification(recommendation, profile, now);
    if (gated.send) {
      await container.notifier.send(gated.recommendation);
      // 히스토리에 남겨야 다음 tick의 recommend()가 30분 재알림 억제를 적용한다.
      await container.pipeline.evidenceStore.saveRecommendations([gated.recommendation]);
      notified.push(gated.recommendation);
    } else {
      heldForQuietHours.push(gated.recommendation);
    }
  }

  // doyeonid 리뷰(PR #66): 리마인더도 일반 추천과 같은 gateNotification(Quiet Hours)
  // 을 거치고, 실제 전달(notifier.send)이 성공한 뒤에만 "보냄"을 커밋한다 — Quiet
  // Hours로 보류되거나 전달 중 예외가 나면 markReminderSent를 저장하지 않아 다음
  // tick에 다시 대상이 된다(전달 전에 먼저 커밋했던 예전 순서의 반대).
  for (const due of findDueReminders([...tasks, ...events], now)) {
    const recommendation = toReminderRecommendation(due, now);
    const gated = gateNotification(recommendation, profile, now);
    if (!gated.send) {
      heldForQuietHours.push(gated.recommendation);
      continue;
    }

    await container.notifier.send(gated.recommendation);
    await container.repository.saveContextItems([markReminderSent(due.item, due.deadline, now)]);
    notified.push(gated.recommendation);
  }

  return {
    syncedSources,
    notified,
    heldForQuietHours,
    newConflicts: conflictCheck.newConflicts,
    withinQuietHours,
  };
}
