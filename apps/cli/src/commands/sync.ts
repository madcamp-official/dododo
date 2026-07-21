import type { CliContainer } from "../runtime/container.ts";
import { syncIncrementally } from "../runtime/incrementalSync.ts";

export async function runSync(container: CliContainer, now: Date = new Date()): Promise<string> {
  const lines = ["dododo sync"];

  // Source 설정 파일 오타·오류를 doctor를 따로 실행해야만 알 수 있으면 위험하다.
  // 설정을 실제로 시도했다가 실패하면 Fixture로 대체하지 않고 수집을 아예 멈춘다
  // (doyeonid, PR #40 리뷰 P1 — 정상 Source까지 데모 데이터로 바뀌는 걸 막는다,
  // container.ts 참고) — 그래서 여기선 "N건 수집" 대신 왜 아무것도 안 도는지 알려준다.
  if (container.sourcesConfigError !== undefined) {
    lines.push(`경고: Source 설정 오류로 수집을 중단합니다 (${container.sourcesConfigError})`);
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
