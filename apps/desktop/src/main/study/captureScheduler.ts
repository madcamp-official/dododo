import {
  decideCaptureTrigger,
  initialCaptureTriggerState,
  type CaptureTriggerState,
} from "./captureTrigger.ts";

const DEFAULT_IDLE_THRESHOLD_SECONDS = 60;
const DEFAULT_LONG_IDLE_THRESHOLD_SECONDS = 10 * 60;
const DEFAULT_MIN_INTERVAL_MS = 3 * 60_000;
const DEFAULT_POLL_INTERVAL_MS = 15_000;

export interface StudyCaptureSchedulerDependencies {
  getIdleSeconds: () => number;
  onTrigger: (reason: "idle-to-active", at: Date) => void;
  onLongIdle?: (at: Date) => void;
  now?: () => Date;
  idleThresholdSeconds?: number;
  longIdleThresholdSeconds?: number;
  minIntervalMs?: number;
  pollIntervalMs?: number;
  // 실제 타이머(node:setInterval/clearInterval)를 기본값으로 쓰되, 테스트에서는 시간을
  // 실제로 기다리지 않고 등록된 콜백을 직접 호출할 수 있도록 주입 지점을 둔다.
  setIntervalFn?: (handler: () => void, ms: number) => unknown;
  clearIntervalFn?: (handle: unknown) => void;
}

export interface StudyCaptureScheduler {
  // 같이 공부하기 세션이 시작될 때(또는 앱 재시작 시 이미 진행 중인 세션을 복원할 때)
  // 호출한다 — 세션이 없을 때는 화면을 들여다보지 않는다(AGENTS.md 최소수집 원칙).
  start(): void;
  stop(): void;
  // 실제 폴링 주기를 기다리지 않고 지금 상태로 한 번 판정한다. 테스트와, 필요하면
  // 세션 종료 시점의 즉시 재평가에도 쓸 수 있다.
  pollOnce(): void;
}

export function createStudyCaptureScheduler(
  dependencies: StudyCaptureSchedulerDependencies,
): StudyCaptureScheduler {
  const now = dependencies.now ?? (() => new Date());
  const idleThresholdSeconds = dependencies.idleThresholdSeconds ?? DEFAULT_IDLE_THRESHOLD_SECONDS;
  const longIdleThresholdSeconds = dependencies.longIdleThresholdSeconds ?? DEFAULT_LONG_IDLE_THRESHOLD_SECONDS;
  const minIntervalMs = dependencies.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
  const pollIntervalMs = dependencies.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const setIntervalFn = dependencies.setIntervalFn ?? ((handler, ms) => setInterval(handler, ms));
  const clearIntervalFn = dependencies.clearIntervalFn ?? ((handle) => clearInterval(handle as NodeJS.Timeout));

  let state: CaptureTriggerState = initialCaptureTriggerState();
  let longIdleNotified = false;
  let handle: unknown;

  function pollOnce(): void {
    // doyeonid 리뷰(PR #92) P2: now()를 한 번만 읽어 판정·lastCaptureAt·onTrigger에
    // 같은 시각을 쓴다 — 두 번 호출하면 전진하는 clock에서 최소 간격 판정 기준과
    // 실제 트리거 시각이 어긋난다.
    const at = now();
    const idleSeconds = dependencies.getIdleSeconds();
    const decision = decideCaptureTrigger(state, {
      now: at,
      idleSeconds,
      idleThresholdSeconds,
      minIntervalMs,
    });
    state = decision.nextState;
    if (idleSeconds >= longIdleThresholdSeconds) {
      if (!longIdleNotified) {
        longIdleNotified = true;
        dependencies.onLongIdle?.(at);
      }
    } else {
      longIdleNotified = false;
    }
    if (decision.trigger && decision.reason !== undefined) {
      dependencies.onTrigger(decision.reason, at);
    }
  }

  function stop(): void {
    if (handle !== undefined) clearIntervalFn(handle);
    handle = undefined;
  }

  function start(): void {
    stop();
    state = initialCaptureTriggerState();
    longIdleNotified = false;
    handle = setIntervalFn(pollOnce, pollIntervalMs);
  }

  return { start, stop, pollOnce };
}
