import type { CliContainer } from "../runtime/container.ts";

// 수동 1회 명령이다 — watch/sync 자동 루프엔 포함되지 않는다(container.ts 주석 참고).
// pipeline.sync()를 그대로 써서 RawItem 저장·Fact 추출·Context 반영까지 다른
// Source와 같은 경로를 탄다(Context Intelligence의 실제 FactExtractor가 붙기
// 전까지는 TempHeuristicFactExtractor가 screen을 분류하지 않아 Context엔 아직
// 반영되지 않을 수 있다 — 이는 Runtime 쪽 버그가 아니라 임시 Extractor의 알려진 범위다).
export async function runScreen(container: CliContainer, now: Date = new Date()): Promise<string> {
  const result = await container.pipeline.sync(container.screenCollector);
  container.syncStatus.record(result, now);

  const lines = ["dododo screen", ""];
  const errorSuffix = result.errors.length > 0 ? ` · 오류: ${result.errors.join(", ")}` : "";
  lines.push(
    `${container.screenCollector.sourceId} (screen): 수집 ${result.collected} · 생성 ${result.created} · 건너뜀 ${result.skipped}${errorSuffix}`,
  );

  return lines.join("\n");
}
