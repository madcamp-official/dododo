import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { createMutex, type Mutex } from "../../../../cli/src/runtime/mutex.ts";
import { fail, ok } from "./result.ts";

interface StoredStudySession {
  sessionId: string;
  startedAt: string;
  adviceCount: number;
}

function isStoredStudySession(value: unknown): value is StoredStudySession {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.sessionId === "string" && record.sessionId !== ""
    && typeof record.startedAt === "string" && !Number.isNaN(Date.parse(record.startedAt))
    && Number.isSafeInteger(record.adviceCount) && (record.adviceCount as number) >= 0;
}

export class StudySessionManager {
  private readonly statePath: string;
  // doyeonid 리뷰(PR #96) P1: start/end/recordAdvice가 각각 readActive() 후
  // write/unlink하는 read-modify-write인데 서로 직렬화되지 않으면, 예를 들어
  // recordAdvice가 기존 세션을 읽은 뒤 end가 먼저 끝나 파일을 지워도 recordAdvice가
  // 그 stale한 값을 다시 써서 이미 끝난 세션을 되살릴 수 있었다(동시 recordAdvice
  // 두 건이 겹치면 증가분을 잃는 것도 같은 문제). container.ts의 syncLock과 같은
  // 이유로 별도 락 라이브러리 없이 Promise 체인 하나로 세 메서드를 직렬화한다.
  // getActive()는 읽기 전용이고 writeActive가 tmp 파일 작성 후 rename하는 원자적
  // 교체라 락 없이도 항상 완전한 파일만 보이므로 대상에서 뺐다.
  private readonly lock: Mutex = createMutex();

  constructor(statePath: string) {
    this.statePath = statePath;
  }

  async getActive() {
    const active = await this.readActive();
    return ok(active === undefined ? undefined : {
      sessionId: active.sessionId,
      startedAt: active.startedAt,
    });
  }

  async start(consent: boolean, now = new Date()) {
    return this.lock.run(async () => {
      if (!consent) return fail("validation", "화면 분석 동의가 필요합니다.");
      if (await this.readActive() !== undefined) {
        return fail("validation", "이미 같이 공부하기 세션이 진행 중입니다.");
      }

      const active: StoredStudySession = {
        sessionId: randomUUID(),
        startedAt: now.toISOString(),
        adviceCount: 0,
      };
      await this.writeActive(active);
      return ok({ sessionId: active.sessionId, startedAt: active.startedAt });
    });
  }

  // 공부 캡처 파이프라인(captureVisionPipeline.ts)이 실제로 advice/distraction
  // 알림을 보낸 뒤에만 호출한다 — 그래서 여기서 다시 sessionId를 대조해, 캡처·Vision
  // 처리 중에 사용자가 세션을 끝냈다면 이미 지워진 세션의 adviceCount를 되살리지
  // 않는다(파일이 없으면 not-found로 실패해 호출부가 조용히 무시할 수 있다).
  async recordAdvice(sessionId: string) {
    return this.lock.run(async () => {
      const active = await this.readActive();
      if (active === undefined || active.sessionId !== sessionId) {
        return fail("not-found", "진행 중인 같이 공부하기 세션을 찾을 수 없습니다.");
      }
      await this.writeActive({ ...active, adviceCount: active.adviceCount + 1 });
      return ok(undefined);
    });
  }

  async end(sessionId: string, now = new Date()) {
    return this.lock.run(async () => {
      const active = await this.readActive();
      if (active === undefined || active.sessionId !== sessionId) {
        return fail("not-found", "진행 중인 같이 공부하기 세션을 찾을 수 없습니다.");
      }
      await this.clearActive();
      const durationMinutes = Math.max(0, Math.floor((now.getTime() - Date.parse(active.startedAt)) / 60_000));
      return ok({
        summaryText: durationMinutes === 0
          ? "같이 공부하기 세션을 종료했어요."
          : `${durationMinutes}분 동안 같이 공부했어요.`,
        durationMinutes,
        adviceCount: active.adviceCount,
      });
    });
  }

  private async readActive(): Promise<StoredStudySession | undefined> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.statePath, "utf8"));
      return isStoredStudySession(parsed) ? parsed : undefined;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || error instanceof SyntaxError) return undefined;
      throw error;
    }
  }

  private async writeActive(active: StoredStudySession): Promise<void> {
    await mkdir(dirname(this.statePath), { recursive: true });
    const temporaryPath = `${this.statePath}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(active, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, this.statePath);
  }

  private async clearActive(): Promise<void> {
    try {
      await unlink(this.statePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}
