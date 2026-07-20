import type { CliContainer } from "../runtime/container.ts";

const USAGE = "사용법: dododo advise --screen [--live]";

// user-scenarios.md Scenario 5: 화면 일시 캡처 → 활동 요약 → 관련 Task 탐색 →
// 조언 또는 거절 렌더링 → 원본 캡처 삭제. screenCollector.sync()를 직접 호출하고
// pipeline.sync()는 쓰지 않는다 — repository/syncStatus에 영구 반영하지 않는
// 1회성 조언이기 때문이다(Context 반영이 필요하면 `dododo screen`을 쓴다).
export async function runAdvise(
  container: CliContainer,
  args: string[],
  now: Date = new Date(),
): Promise<string> {
  if (!args.includes("--screen")) {
    return `advise는 현재 --screen만 지원합니다.\n${USAGE}`;
  }

  if (args.includes("--live")) {
    return runLiveCapture(container);
  }

  const [activity] = await container.screenCollector.sync();
  if (activity === undefined) {
    return "캡처할 화면 활동이 없습니다.";
  }

  // TODO(screen-capture-v2): 실제 화면 캡처로 바뀌면 여기서 캡처 원본 파일을
  // 삭제한다. 지금은 정적 fixture를 읽을 뿐 실제 캡처 파일이 없어 no-op이다.

  const contextItems = await container.repository.listContextItems();
  const decision = await container.screenAdvicePolicy.evaluate({ activity, contextItems, now });

  if (!decision.advise) {
    return ["조언하지 않습니다.", `이유: ${decision.declineReason ?? "알 수 없음"}`].join("\n");
  }

  const lines = ["화면 기반 조언", "", decision.message ?? ""];
  if (decision.evidenceIds !== undefined && decision.evidenceIds.length > 0) {
    lines.push(`근거: ${decision.evidenceIds.join(", ")}`);
  }
  return lines.join("\n");
}

// 실제 픽셀 캡처는 Windows에서 동작하지만 Vision 분석이 아직 어디에도 연결되지
// 않아(docs/llm-architecture.md §3) 이미지를 활동 요약으로 바꿀 방법이 없다.
// 그래서 지금은 캡처 성공/실패만 정직하게 보고하고 이미지 바이트는 여기서 스코프를
// 벗어나며 버려진다 — 로그에도, 어디에도 남기지 않는다.
// TODO(screen-capture-v2): Vision 분석이 붙으면 capture.imageBase64를 그쪽에 넘기고
// 이 함수를 지우거나 위 fixture 경로와 합친다.
async function runLiveCapture(container: CliContainer): Promise<string> {
  try {
    const capture = await container.captureLiveScreen();
    return [
      "실시간 화면 캡처 완료.",
      `크기: ${capture.byteLength} bytes, 시각: ${capture.capturedAt.toISOString()}`,
      "Vision 분석이 아직 연결되지 않아 활동 요약과 조언은 생성할 수 없습니다.",
    ].join("\n");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return `실시간 화면 캡처에 실패했습니다: ${reason}`;
  }
}
