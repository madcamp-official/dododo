import { createMutex } from "../../../../cli/src/runtime/mutex.ts";
import type { Result } from "../ipc/result.ts";

export interface ActiveStudySessionSummary {
  sessionId: string;
  startedAt: string;
}

export interface CaptureSchedulerHandle {
  start(): void;
  stop(): void;
}

export interface CaptureSchedulerSync {
  sync(): Promise<void>;
}

// doyeonid 리뷰(PR #92) P1: 부팅 시 복원 확인(studySessions.getActive())이 study:end보다
// 늦게 끝나면, 이미 세션이 끝났는데도 뒤늦게 도착한 콜백이 scheduler를 다시 시작시킬 수
// 있었다 — "세션 없음"인데 Idle 감시가 계속 도는 상태로 남는다.
//
// createMutex()로 모든 재확인 호출(부팅 시 복원, study:start, study:end)을 한 줄로
// 직렬화하고, 매 호출이 지금 시점의 studySessions.getActive()를 다시 읽어 scheduler를
// 그 결과에 맞춘다 — 어떤 호출이 실제로 먼저 끝나든, 나중에 큐에 들어간 호출이 항상
// 마지막에 다시 검증하므로 최종 상태는 항상 "가장 나중에 확인된 진짜 상태"로 수렴한다.
export function createCaptureSchedulerSync(dependencies: {
  getActive: () => Promise<Result<ActiveStudySessionSummary | undefined>>;
  scheduler: CaptureSchedulerHandle;
}): CaptureSchedulerSync {
  const lock = createMutex();
  return {
    sync(): Promise<void> {
      return lock.run(async () => {
        const result = await dependencies.getActive();
        if (result.ok && result.data !== undefined) {
          dependencies.scheduler.start();
        } else {
          dependencies.scheduler.stop();
        }
      });
    },
  };
}
