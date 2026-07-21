import type { CliContainer } from "../../../../cli/src/runtime/container.ts";
import { listTodayEntries, type RecommendedEntry } from "../../../../cli/src/commands/today.ts";
import { runResult, type Result } from "./result.ts";

export interface TodayGetResponse {
  entries: RecommendedEntry[];
}

// CLI의 renderToday와 같은 listTodayEntries(container.ts 참고)를 그대로 재사용한다 —
// 문자열 포매팅 대신 ContextItem+Recommendation을 그대로 노출해 Renderer가 직접 꾸민다
// (docs/frontend-plan.md §6.1 today:get, ContextItem/Recommendation은 packages/shared
// 타입을 그대로 씀).
export async function getToday(container: CliContainer, now: Date = new Date()): Promise<Result<TodayGetResponse>> {
  return runResult(async () => {
    const { entries } = await listTodayEntries(container, now);
    return { entries };
  });
}
