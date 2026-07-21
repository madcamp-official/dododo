import type { CliContainer } from "../../../../cli/src/runtime/container.ts";
import { syncIncrementally } from "../../../../cli/src/runtime/incrementalSync.ts";
import { fail, toResult, type Result } from "./result.ts";

export interface SyncSummary {
  collected: number;
  created: number;
}

// sync.ts(CLI)와 같은 정책: Source 설정 오류면 Fixture로 섞지 않고 수집을 멈춘다
// (PR #40 리뷰, doyeonid P1). docs/frontend-plan.md 6.1: 오류는 성공 응답의 필드가
// 아니라 Result<T>의 실패 쪽(error.code: "sources-config-error")으로만 알린다 —
// 성공 응답엔 항상 undefined인 필드를 두지 않는다.
export async function runSync(container: CliContainer, now: Date = new Date()): Promise<Result<SyncSummary>> {
  if (container.sourcesConfigError !== undefined) {
    return fail("sources-config-error", container.sourcesConfigError);
  }
  if (container.collectors.length === 0) {
    return toResult(async () => ({ collected: 0, created: 0 }));
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
    return { collected, created };
  });
}
