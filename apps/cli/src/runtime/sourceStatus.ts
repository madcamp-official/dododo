import type { CliContainer } from "./container.ts";

export function renderSourceStatus(container: CliContainer): string {
  const lines = ["Source 상태:"];

  for (const collector of container.collectors) {
    const status = container.syncStatus.get(collector.sourceId);
    if (status === undefined) {
      lines.push(`  ${collector.sourceId} (${collector.sourceType}): 미동기화`);
      continue;
    }

    const errorSuffix = status.lastResult.errors.length > 0
      ? ` · 오류: ${status.lastResult.errors.join(", ")}`
      : "";
    lines.push(
      `  ${collector.sourceId} (${collector.sourceType}): 마지막 동기화 ${status.lastSyncedAt} · 생성 ${status.lastResult.created}${errorSuffix}`,
    );
  }

  return lines.join("\n");
}
