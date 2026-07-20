import { setTimeout as delay } from "node:timers/promises";

import type { CliContainer } from "./container.ts";
import { runWatchTick, type WatchTickResult } from "./watchTick.ts";

export interface WatchLoopOptions {
  intervalMs: number;
  now?: () => Date;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  // 기본 Infinity. 테스트는 작은 값을 넣어 실제 대기 없이 루프를 끝낸다.
  maxIterations?: number;
  signal?: AbortSignal;
  onTick?: (result: WatchTickResult, iteration: number) => void;
  // 한 tick(profile/context/recommendation/history/notifier 등)이 예외를 던지면
  // 그 tick만 실패로 기록하고 다음 interval로 넘어간다 — watch는 오래 켜두는
  // 프로세스라 tick 하나의 일시 오류로 전체가 죽으면 안 된다(팀 리뷰 지적).
  onTickError?: (error: unknown, iteration: number) => void;
  // true(기본)면 매 tick 결과를 배열로 모아 반환한다. 무한히(또는 아주 오래) 도는
  // 실행에선 false로 둬서 메모리가 tick 수에 비례해 계속 자라지 않게 한다(팀 리뷰
  // 지적) — tickCount/totalNotified 요약은 keepResults와 무관하게 항상 정확하다.
  keepResults?: boolean;
}

export interface WatchLoopSummary {
  results: WatchTickResult[];
  tickCount: number;
  totalNotified: number;
  tickErrorCount: number;
}

async function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  try {
    await delay(ms, undefined, { signal });
  } catch (error) {
    // signal이 대기 도중 abort되면 즉시 깨어난 것으로 취급한다 — 호출자가 그
    // 직후 signal.aborted를 다시 확인해 루프를 정리하므로 여기서 다시 던지지 않는다.
    if (error instanceof Error && error.name === "AbortError") return;
    throw error;
  }
}

// tick을 최소 1번은 항상 실행한 뒤(pre-abort된 signal이어도) maxIterations/abort를
// 확인한다 — "watch를 껐다 켰다"가 아니라 "최소 한 번은 상태를 본다"는 게 더 안전한
// 기본값이라 판단했다. sleep 이후에도 한 번 더 확인해 대기 중 abort된 경우 불필요한
// 추가 tick 없이 곧바로 멈춘다.
export async function runWatchLoop(
  container: CliContainer,
  options: WatchLoopOptions,
): Promise<WatchLoopSummary> {
  const now = options.now ?? (() => new Date());
  const sleep = options.sleep ?? defaultSleep;
  const maxIterations = options.maxIterations ?? Number.POSITIVE_INFINITY;
  const keepResults = options.keepResults ?? true;
  const results: WatchTickResult[] = [];
  let tickCount = 0;
  let totalNotified = 0;
  let tickErrorCount = 0;

  for (;;) {
    tickCount += 1;
    try {
      const result = await runWatchTick(container, now());
      totalNotified += result.notified.length;
      if (keepResults) results.push(result);
      options.onTick?.(result, tickCount);
    } catch (error) {
      tickErrorCount += 1;
      options.onTickError?.(error, tickCount);
    }

    if (tickCount >= maxIterations || (options.signal?.aborted ?? false)) break;

    await sleep(options.intervalMs, options.signal);
    if (options.signal?.aborted ?? false) break;
  }

  return { results, tickCount, totalNotified, tickErrorCount };
}
