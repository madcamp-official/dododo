import type { CliContainer } from "../runtime/container.ts";
import { runWatchLoop } from "../runtime/watchLoop.ts";
import type { WatchTickResult } from "../runtime/watchTick.ts";

const USAGE = "사용법: dododo watch [--loop] [--interval <seconds>]";
const DEFAULT_INTERVAL_SECONDS = 300;
const KNOWN_FLAGS = new Set(["--loop", "--interval"]);

// docs/architecture.md: "MVP, 실제 데몬 아님" — 기본은 1회 실행이고, 계속 도는
// 것은 --loop를 명시했을 때만이다. --loop일 땐 여러 실제 tick에 걸쳐 시간이
// 흐르므로 매 tick 실제 시각을 써야 한다(주입된 now는 "지금 1회 실행"에만 쓴다).
export async function runWatch(
  container: CliContainer,
  args: string[],
  now: Date = new Date(),
): Promise<string> {
  const loop = args.includes("--loop");
  const intervalArg = findFlagValue(args, "--interval");

  let intervalSeconds = DEFAULT_INTERVAL_SECONDS;
  if (intervalArg !== undefined) {
    const parsed = Number(intervalArg);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return `--interval은 0보다 큰 초 단위 숫자여야 합니다: ${intervalArg}\n${USAGE}`;
    }
    intervalSeconds = parsed;
  }

  const unknownFlag = args.find((arg) => arg.startsWith("--") && !KNOWN_FLAGS.has(arg));
  if (unknownFlag !== undefined) {
    return `알 수 없는 옵션입니다: ${unknownFlag}\n${USAGE}`;
  }

  const controller = new AbortController();
  const onSigint = (): void => controller.abort();
  process.on("SIGINT", onSigint);

  const lines: string[] = [];
  try {
    const results = await runWatchLoop(container, {
      intervalMs: intervalSeconds * 1000,
      maxIterations: loop ? undefined : 1,
      signal: controller.signal,
      now: loop ? () => new Date() : () => now,
      onTick: (result, iteration) => lines.push(renderTickLine(result, iteration)),
    });

    const totalNotified = results.reduce((sum, result) => sum + result.notified.length, 0);
    lines.push(`Watch 종료: ${results.length}회 실행, 총 ${totalNotified}건 알림`);
  } finally {
    process.off("SIGINT", onSigint);
  }

  return lines.join("\n");
}

function renderTickLine(result: WatchTickResult, iteration: number): string {
  const errorCount = result.syncedSources.reduce((sum, source) => sum + source.errors.length, 0);
  const errorSuffix = errorCount > 0 ? ` · 오류 ${errorCount}건` : "";
  return `[tick ${iteration}] 동기화 ${result.syncedSources.length}개 · 알림 ${result.notified.length}건`
    + ` · Quiet Hours 보류 ${result.heldForQuietHours.length}건${errorSuffix}`;
}

function findFlagValue(args: string[], flag: string): string | undefined {
  const flagIndex = args.indexOf(flag);
  if (flagIndex === -1) return undefined;
  return args[flagIndex + 1];
}
