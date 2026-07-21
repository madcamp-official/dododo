import type { CliContainer } from "../../../../cli/src/runtime/container.ts";
import { syncIncrementally } from "../../../../cli/src/runtime/incrementalSync.ts";
import { fail, toResult, type Result } from "./result.ts";

export interface SyncSummary {
  collected: number;
  created: number;
  sourcesConfigError: string | undefined;
}

// sync.ts(CLI)와 같은 정책: Source 설정 오류면 Fixture로 섞지 않고 수집을 멈춘다
// (PR #40 리뷰, doyeonid P1) — 여기서도 조용히 성공한 것처럼 안 보이도록
// sourcesConfigError를 결과에 그대로 실어 보낸다.
export async function runSync(container: CliContainer, now: Date = new Date()): Promise<Result<SyncSummary>> {
  if (container.sourcesConfigError !== undefined) {
    return fail("sources-config-error", container.sourcesConfigError);
  }
  if (container.collectors.length === 0) {
    return toResult(async () => ({ collected: 0, created: 0, sourcesConfigError: undefined }));
  }

  return toResult(async () => {
    let collected = 0;
    let created = 0;
    for (const collector of container.collectors) {
      const result = await syncIncrementally(collector, container.pipeline, container.rawItemRepository);
      container.syncStatus.record(result, now);
      collected += result.collected;
      created += result.created;
    }
    return { collected, created, sourcesConfigError: undefined };
  });
}
