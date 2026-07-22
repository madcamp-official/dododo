import type { Result } from "../ipc/result.ts";

export interface CaptureSchedulerHandle {
  start(): void;
  stop(): void;
}

export interface CaptureSchedulerCoordinator {
  // study:start/study:end가 성공해서 활성 상태가 확정된 바로 그 순간, 재확인 없이
  // 동기적으로 scheduler를 그 상태로 맞춘다. 우리가 방금 그 상태를 만든 당사자이므로
  // 다시 물어볼 필요가 없다 — 그래서 지연도, 그 사이 잘못된 상태가 노출되는 구간도
  // 없다. 이후 부팅 시 확인이 아직 안 끝났더라도 그 결과는 항상 폐기된다(아래 참고).
  applyKnownState(active: boolean): void;
  // 앱 시작 시 한 번 호출한다. 이 호출이 시작된 뒤 끝나기 전에 applyKnownState가
  // 먼저 호출되면(사용자가 그새 study:start/study:end를 실행) 이 확인의 결과는 그냥
  // 버린다 — applyKnownState가 이미 실제로 벌어진 일을 반영한 더 최신 정보이기
  // 때문이다. doyeonid 리뷰(PR #92) P1 재검토: mutex로 순서만 직렬화하면 "최종
  // 상태"는 맞아도 그 사이 scheduler가 잘못 켜지는 구간 자체는 막지 못한다 — 여기서는
  // 그 구간이 생길 조건(부팅 확인이 늦게 끝났는데 그 사이 확정 상태가 생김)을 세대
  // 번호로 감지해 아예 적용을 건너뛴다.
  applyBootCheck(getActive: () => Promise<Result<unknown>>): Promise<void>;
}

export function createCaptureSchedulerCoordinator(
  scheduler: CaptureSchedulerHandle,
): CaptureSchedulerCoordinator {
  let generation = 0;

  function applyKnownState(active: boolean): void {
    generation += 1;
    if (active) scheduler.start();
    else scheduler.stop();
  }

  async function applyBootCheck(getActive: () => Promise<Result<unknown>>): Promise<void> {
    const bootGeneration = generation;
    const result = await getActive();
    // 확인이 끝나기 전에 study:start/study:end가 먼저 상태를 확정했다 — 그 결과가
    // 이미 더 최신이므로 이 확인은 아무 것도 하지 않는다.
    if (generation !== bootGeneration) return;

    if (result.ok && result.data !== undefined) scheduler.start();
    else scheduler.stop();
  }

  return { applyKnownState, applyBootCheck };
}
