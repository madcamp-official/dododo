import type { CliContainer } from "../../../../cli/src/runtime/container.ts";
import { runWatchLoop } from "../../../../cli/src/runtime/watchLoop.ts";
import { broadcastNotification } from "../notifier/broadcast.ts";
import { toConflictEvents } from "./conflictEvents.ts";
import { summarizeSyncForNotification } from "./syncCompleteSummary.ts";

// CLI의 watch 명령(apps/cli/src/commands/watch.ts)과 같은 기본 주기 — 값을 바꿀 땐
// 두 곳을 함께 검토한다(하나는 CLI 프로세스 수명, 하나는 데스크톱 앱 수명 동안 상시 실행).
const DEFAULT_INTERVAL_SECONDS = 300;

export interface DesktopWatchHandle {
  stop: () => void;
}

// 앱이 떠 있는 동안 상시 실행한다(docs/frontend-plan.md 3번 "watch/watchTick을
// Main에서 상시 실행"). CLI watch와 달리 SIGINT가 아니라 app "before-quit"에서
// stop()으로 멈춘다 — 호출부(index.mjs)가 그 시점을 안다.
export function startDesktopWatch(
  container: CliContainer,
  intervalSeconds: number = DEFAULT_INTERVAL_SECONDS,
): DesktopWatchHandle {
  const controller = new AbortController();

  void runWatchLoop(container, {
    intervalMs: intervalSeconds * 1000,
    keepResults: false,
    signal: controller.signal,
    onTick: (result, iteration) => {
      const tickNow = new Date();
      const summary = summarizeSyncForNotification(result.syncedSources, tickNow);
      if (summary !== undefined) broadcastNotification(summary);

      for (const event of toConflictEvents(result.newConflicts, tickNow)) broadcastNotification(event);
      // 리마인더는 더 이상 여기서 따로 push하지 않는다 — watchTick.ts가 다른 추천과
      // 같은 gateNotification → container.notifier.send 경로를 타고, 그 경로 끝에서
      // ElectronDesktopNotifier가 classifyRecommendation으로 "reminder-" id를 인식해
      // 자동으로 IPC broadcast한다(doyeonid 리뷰 PR #66 — Quiet Hours를 우회하지
      // 않고, 실제 전달 성공 후에만 발송 완료로 커밋하기 위한 재구성).

      const errorCount = result.syncedSources.reduce((sum, source) => sum + source.errors.length, 0);
      if (errorCount > 0) {
        console.error(`[watch tick ${iteration}] Source 오류 ${errorCount}건 (다른 Source는 계속 진행됨)`);
      }
    },
    onTickError: (error, iteration) => {
      // watchLoop.ts와 같은 이유로 tick 하나의 예외가 상시 루프 전체를 죽이면 안 된다.
      console.error(
        `[watch tick ${iteration}] 오류로 이번 tick을 건너뜁니다: ${error instanceof Error ? error.message : String(error)}`,
      );
    },
  });

  return { stop: () => controller.abort() };
}
