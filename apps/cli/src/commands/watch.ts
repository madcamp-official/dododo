import { WindowsOsNotifier } from "../../../../packages/scheduler/src/index.ts";
import type { CliContainer } from "../runtime/container.ts";
import { runWatchLoop } from "../runtime/watchLoop.ts";
import type { WatchTickResult } from "../runtime/watchTick.ts";

const USAGE = "사용법: dododo watch [--once] [--interval <seconds>] [--os-notify]";
const DEFAULT_INTERVAL_SECONDS = 300;
// Node 타이머(setTimeout 계열)는 지연을 32비트 부호 있는 정수(ms)로 다뤄
// 2147483647ms(약 24.8일)를 넘으면 오버플로로 1ms로 바뀌어 즉시 실행된다.
// 그 함정을 조용히 밟지 않도록 명시적으로 상한을 두고 거부한다(팀 리뷰 지적).
const MAX_INTERVAL_SECONDS = Math.floor(2_147_483_647 / 1000);
const KNOWN_FLAGS = new Set(["--once", "--interval", "--os-notify"]);

// docs/architecture.md·docs/mvp-scope.md: watch 프로세스가 실행되는 동안 계속
// 주기 동기화한다 — 기본은 지속 실행이고, 1회만 확인하려면 --once를 명시한다
// (단발성은 이미 `sync` 명령이 있으므로 watch의 기본값까지 1회면 이름과 다른
// 명령 둘 다와 기대가 어긋난다는 팀 리뷰 지적 반영). 지속 실행일 땐 여러 실제
// tick에 걸쳐 시간이 흐르므로 매 tick 실제 시각을 써야 한다(주입된 now는
// --once에만 쓴다).
export async function runWatch(
  container: CliContainer,
  args: string[],
  now: Date = new Date(),
): Promise<string> {
  const once = args.includes("--once");
  const intervalArg = findFlagValue(args, "--interval");

  let intervalSeconds = DEFAULT_INTERVAL_SECONDS;
  if (intervalArg !== undefined) {
    const parsed = Number(intervalArg);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return `--interval은 0보다 큰 초 단위 숫자여야 합니다: ${intervalArg}\n${USAGE}`;
    }
    if (parsed > MAX_INTERVAL_SECONDS) {
      return `--interval은 ${MAX_INTERVAL_SECONDS}초를 넘을 수 없습니다(Node 타이머 한계): ${intervalArg}\n${USAGE}`;
    }
    intervalSeconds = parsed;
  }

  const unknownFlag = args.find((arg) => arg.startsWith("--") && !KNOWN_FLAGS.has(arg));
  if (unknownFlag !== undefined) {
    return `알 수 없는 옵션입니다: ${unknownFlag}\n${USAGE}`;
  }

  // container를 그대로 변형하지 않고 notifier만 교체한 얕은 복사본을 쓴다 —
  // 호출자가 넘긴 container 객체를 이 함수가 몰래 바꿔놓지 않기 위함이다.
  const effectiveContainer = args.includes("--os-notify")
    ? { ...container, notifier: new WindowsOsNotifier() }
    : container;

  // sync와 같은 이유로 tick이 시작되기 전에 맨 위에 찍는다(PR #40 리뷰, 김도현 지적).
  // 설정 오류면 Fixture로 대체하지 않고 수집이 통째로 멈춘다(doyeonid P1, container.ts 참고).
  if (effectiveContainer.sourcesConfigError !== undefined) {
    console.log(`경고: Source 설정 오류로 수집을 중단합니다 (${effectiveContainer.sourcesConfigError})`);
  }

  const controller = new AbortController();
  const onSigint = (): void => controller.abort();
  process.on("SIGINT", onSigint);

  // tick 요약은 매 tick console.log로 바로 찍는다 — 지속 실행(기본값)에서는 프로세스가
  // 오래 살아있으므로, 함수가 끝날 때 한 번에 모아 반환하면 SIGINT 전까지 화면에
  // 아무 진행 상황도 안 보인다. 최종 반환 문자열은 종료 요약 한 줄뿐이다.
  try {
    const summary = await runWatchLoop(effectiveContainer, {
      intervalMs: intervalSeconds * 1000,
      maxIterations: once ? 1 : undefined,
      keepResults: once,
      signal: controller.signal,
      now: once ? () => now : () => new Date(),
      onTick: (result, iteration) => console.log(renderTickLine(result, iteration)),
      onTickError: (error, iteration) => console.error(renderTickErrorLine(error, iteration)),
    });

    const errorSuffix = summary.tickErrorCount > 0 ? ` · tick 오류 ${summary.tickErrorCount}건` : "";
    return `Watch 종료: ${summary.tickCount}회 실행, 총 ${summary.totalNotified}건 알림${errorSuffix}`;
  } finally {
    process.off("SIGINT", onSigint);
  }
}

function renderTickLine(result: WatchTickResult, iteration: number): string {
  const errorCount = result.syncedSources.reduce((sum, source) => sum + source.errors.length, 0);
  const errorSuffix = errorCount > 0 ? ` · 오류 ${errorCount}건` : "";
  const conflictSuffix = result.newConflicts.length > 0 ? ` · 일정 충돌 ${result.newConflicts.length}건` : "";
  return `[tick ${iteration}] 동기화 ${result.syncedSources.length}개 · 알림 ${result.notified.length}건`
    + ` · Quiet Hours 보류 ${result.heldForQuietHours.length}건${conflictSuffix}${errorSuffix}`;
}

function renderTickErrorLine(error: unknown, iteration: number): string {
  const reason = error instanceof Error ? error.message : String(error);
  return `[tick ${iteration}] 오류로 이번 tick을 건너뜁니다: ${reason}`;
}

function findFlagValue(args: string[], flag: string): string | undefined {
  const flagIndex = args.indexOf(flag);
  if (flagIndex === -1) return undefined;
  return args[flagIndex + 1];
}
