import type { CliContainer } from "../runtime/container.ts";
import { syncIncrementally } from "../runtime/incrementalSync.ts";

export async function runSync(container: CliContainer, now: Date = new Date()): Promise<string> {
  const lines = ["dododo sync", ""];

  if (container.collectors.length === 0) {
    lines.push("등록된 Source(Fixture)가 없습니다.");
    return lines.join("\n");
  }

  for (const collector of container.collectors) {
    const result = await syncIncrementally(collector, container.pipeline, container.rawItemRepository);
    container.syncStatus.record(result, now);

    const errorSuffix = result.errors.length > 0 ? ` · 오류: ${result.errors.join(", ")}` : "";
    lines.push(
      `${collector.sourceId} (${collector.sourceType}): 수집 ${result.collected} · 생성 ${result.created} · 건너뜀 ${result.skipped}${errorSuffix}`,
    );
  }

  return lines.join("\n");
}
