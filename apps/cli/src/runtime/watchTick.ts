import { gateNotification } from "../../../../packages/scheduler/src/index.ts";
import type { Recommendation, SyncResult } from "../../../../packages/shared/src/index.ts";
import { emptyProfile, type CliContainer } from "./container.ts";
import { syncIncrementally } from "./incrementalSync.ts";
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
