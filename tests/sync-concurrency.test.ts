import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

import { runSync as runIpcSync } from "../apps/desktop/src/main/ipc/sync.ts";
import { createCliContainer } from "../apps/cli/src/runtime/container.ts";
import { runWatchTick } from "../apps/cli/src/runtime/watchTick.ts";
import type { Collector, RawItem } from "../packages/shared/src/index.ts";

// 매번 새 sync() 호출마다 살짝 다른 content로 새 RawItem을 만드는 느린 Collector 하나로
// container.collectors를 교체한다 — sync() 안에서 실제로 지연이 있어야 두 sync 경로가
// "동시에 실행됐는지" 검증할 수 있다.
function slowCollector(concurrency: { active: number; max: number }, delayMs: number): Collector {
  let call = 0;
  return {
    sourceId: "slow-source",
    sourceType: "school-site",
    async sync(): Promise<RawItem[]> {
      concurrency.active += 1;
      concurrency.max = Math.max(concurrency.max, concurrency.active);
      await delay(delayMs);
      call += 1;
      const now = new Date("2026-07-21T10:00:00+09:00").toISOString();
      concurrency.active -= 1;
      return [{
        id: `raw-slow-${call}`,
        sourceId: "slow-source",
        sourceType: "school-site",
        uri: `https://slow.example/${call}`,
        content: `content-${call}`,
        contentHash: `hash-${call}`,
        observedAt: now,
        metadata: {},
      }];
    },
  };
}

test("watch tick의 동기화와 수동 sync:run은 syncLock으로 직렬화되어 동시에 실행되지 않는다(doyeonid 리뷰 PR #61)", async () => {
  const container = createCliContainer({ databasePath: ":memory:" });
  const concurrency = { active: 0, max: 0 };
  container.collectors = [slowCollector(concurrency, 30)];

  await Promise.all([
    runWatchTick(container, new Date("2026-07-21T10:00:00+09:00")),
    runIpcSync(container, new Date("2026-07-21T10:00:00+09:00")),
  ]);

  assert.equal(concurrency.max, 1, "watch tick 동기화와 sync:run이 동시에 collector.sync()를 실행하면 안 됨");
});
