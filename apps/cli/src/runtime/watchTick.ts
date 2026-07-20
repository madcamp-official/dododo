import { gateNotification } from "../../../../packages/scheduler/src/index.ts";
import type { Recommendation, SyncResult } from "../../../../packages/shared/src/index.ts";
import { emptyProfile, type CliContainer } from "./container.ts";
import { isSnoozed } from "./snooze.ts";

export interface WatchTickResult {
  syncedSources: SyncResult[];
  notified: Recommendation[];
  heldForQuietHours: Recommendation[];
}

// docs/architecture.md §3 Watch Process 흐름 한 번(수집 스케줄 확인 → 동기화 →
// 알림 후보 계산 → 정책 통과 알림 전송)을 수행한다. 루프/타이머는 watchLoop.ts가
// 감싸며, 이 함수 자체는 순수하게 "한 번" 실행만 책임져 테스트하기 쉽다.
export async function runWatchTick(container: CliContainer, now: Date): Promise<WatchTickResult> {
  const syncedSources: SyncResult[] = [];
  for (const collector of container.collectors) {
    const result = await container.pipeline.sync(collector);
    container.syncStatus.record(result, now);
    syncedSources.push(result);
  }

  const tasks = await container.repository.listContextItems("task");
  const events = await container.repository.listContextItems("event");
  const opportunities = await container.repository.listContextItems("opportunity");
  const items = [...tasks, ...events, ...opportunities];
  const itemsById = new Map(items.map((item) => [item.id, item]));

  const profile = (await container.profileRepository.get()) ?? emptyProfile();
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

  return { syncedSources, notified, heldForQuietHours };
}
