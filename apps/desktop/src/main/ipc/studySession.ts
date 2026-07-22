import { randomUUID } from "node:crypto";

import { fail, ok } from "./result.ts";

interface ActiveStudySession {
  id: string;
  startedAt: Date;
  adviceCount: number;
}

export class StudySessionManager {
  private active: ActiveStudySession | undefined;

  start(consent: boolean, now = new Date()) {
    if (!consent) return fail("validation", "화면 분석 동의가 필요합니다.");
    if (this.active !== undefined) return fail("validation", "이미 같이 공부하기 세션이 진행 중입니다.");

    this.active = { id: randomUUID(), startedAt: now, adviceCount: 0 };
    return ok({ sessionId: this.active.id, startedAt: now.toISOString() });
  }

  end(sessionId: string, now = new Date()) {
    if (this.active === undefined || this.active.id !== sessionId) {
      return fail("not-found", "진행 중인 같이 공부하기 세션을 찾을 수 없습니다.");
    }
    const active = this.active;
    this.active = undefined;
    const durationMinutes = Math.max(0, Math.floor((now.getTime() - active.startedAt.getTime()) / 60_000));
    return ok({
      summaryText: durationMinutes === 0
        ? "같이 공부하기 세션을 종료했어요."
        : `${durationMinutes}분 동안 같이 공부했어요.`,
      durationMinutes,
      adviceCount: active.adviceCount,
    });
  }
}
