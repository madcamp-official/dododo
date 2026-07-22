import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

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
  }

  async end(sessionId: string, now = new Date()) {
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
