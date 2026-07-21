import type { CliContainer } from "../runtime/container.ts";
import { syncIncrementally } from "../runtime/incrementalSync.ts";

export async function runSync(container: CliContainer, now: Date = new Date()): Promise<string> {
  const lines = ["dododo sync"];

  // Source 설정 파일 오타·오류로 Fixture 데모 데이터를 대신 수집 중인 상태를 doctor를
  // 따로 실행해야만 알 수 있으면 위험하다 — "수집 N건" 성공 메시지만 보고 실제 학교
  // 데이터를 수집한 줄 착각할 수 있다(PR #40 리뷰, 김도현 지적).
  if (container.sourcesConfigError !== undefined) {
    lines.push(`경고: Source 설정 오류로 Fixture 데모 데이터를 수집 중입니다 (${container.sourcesConfigError})`);
  }
  lines.push("");

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
