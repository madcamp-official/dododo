// docs/frontend-plan.md 2.5: "같이 공부하기" 세션 중 화면 캡처는 3분 고정 폴링 대신
// 앱 전환·Idle→Active 같은 이벤트 기반 트리거로 하기로 했다. 앱 전환 감지는 다른 앱의
// 포그라운드 창을 알아내는 새 의존성(예: active-win)이 필요해(AGENTS.md: 불필요한 새
// 의존성을 추가하지 않는다, 필요하면 목적·대안을 먼저 논의) 이번 PR에는 포함하지 않았다.
// 이 파일은 Electron의 기존 powerMonitor만으로 가능한 Idle→Active 판정만 다룬다.
export interface CaptureTriggerState {
  wasIdle: boolean;
  lastCaptureAt: Date | undefined;
}

export interface CaptureTriggerInput {
  now: Date;
  idleSeconds: number;
  idleThresholdSeconds: number;
  minIntervalMs: number;
}

export interface CaptureTriggerDecision {
  trigger: boolean;
  reason: "idle-to-active" | undefined;
  nextState: CaptureTriggerState;
}

export function initialCaptureTriggerState(): CaptureTriggerState {
  return { wasIdle: false, lastCaptureAt: undefined };
}

// 순수 함수 — Date를 주입받아 시스템 로컬 시간에 암묵적으로 의존하지 않는다(AGENTS.md).
// "Idle→Active"만 트리거로 본다: 유휴 상태로 들어가는 순간(Active→Idle)은 화면을 볼 필요가
// 없고, 유휴 상태가 계속 유지되는 동안 매 tick 다시 트리거하지도 않는다(wasIdle로 막음).
// minIntervalMs는 idle↔active를 짧게 반복할 때 캡처가 연달아 일어나지 않게 하는 하한이다.
export function decideCaptureTrigger(
  state: CaptureTriggerState,
  input: CaptureTriggerInput,
): CaptureTriggerDecision {
  const isIdleNow = input.idleSeconds >= input.idleThresholdSeconds;
  const idleToActive = state.wasIdle && !isIdleNow;
  const withinMinInterval = state.lastCaptureAt !== undefined
    && input.now.getTime() - state.lastCaptureAt.getTime() < input.minIntervalMs;
  const trigger = idleToActive && !withinMinInterval;

  return {
    trigger,
    reason: trigger ? "idle-to-active" : undefined,
    nextState: {
      wasIdle: isIdleNow,
      lastCaptureAt: trigger ? input.now : state.lastCaptureAt,
    },
  };
}
