import type { CliContainer } from "../../../../cli/src/runtime/container.ts";
import { runSyncStructured, type SourceSyncResult } from "../../../../cli/src/commands/sync.ts";
import { runResult, type Result } from "./result.ts";

export interface SyncRunResponse {
  collected: number;
  created: number;
  sourcesConfigError: string | undefined;
  sources: SourceSyncResult[];
}

// docs/frontend-plan.md §6.1 draft는 { collected, created }만 정의하지만, Source별
// 오류(§6.5 에러 표시 원칙)와 설정 오류를 조용히 삼키지 않기 위해 sources/sourcesConfigError를
// 덧붙인다 — 기존 두 필드를 지우지 않는 추가라 draft와 충돌하지 않는다.
export async function runSyncIpc(container: CliContainer, now: Date = new Date()): Promise<Result<SyncRunResponse>> {
  return runResult(async () => {
    const { sourcesConfigError, sources } = await runSyncStructured(container, now);
    return {
      collected: sources.reduce((sum, source) => sum + source.collected, 0),
      created: sources.reduce((sum, source) => sum + source.created, 0),
      sourcesConfigError,
      sources,
    };
  });
}
