import { extractScreenActivity } from "../../../../packages/context-engine/src/index.ts";
import type { ScreenAdviceDecision } from "../runtime/adviceLookup.ts";
import type { CliContainer } from "../runtime/container.ts";

const USAGE = "사용법: dododo advise --screen [--live] [--focus]";

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

  const focusMode = args.includes("--focus");

  if (args.includes("--live")) {
    return runLiveCapture(container, focusMode, now);
  }

  const [activity] = await container.screenCollector.sync();
  if (activity === undefined) {
    return "캡처할 화면 활동이 없습니다.";
  }

  const contextItems = await container.repository.listContextItems();
  const decision = await container.screenAdvicePolicy.evaluate({ activity, contextItems, now, focusMode });
  return renderDecision(decision);
}

function renderDecision(decision: ScreenAdviceDecision): string {
  if (!decision.advise) {
    return ["조언하지 않습니다.", `이유: ${decision.declineReason ?? "알 수 없음"}`].join("\n");
  }

  const lines = ["화면 기반 조언", "", decision.message ?? ""];
  if (decision.evidenceIds !== undefined && decision.evidenceIds.length > 0) {
    lines.push(`근거: ${decision.evidenceIds.join(", ")}`);
  }
  return lines.join("\n");
}

// 실제 픽셀 캡처(Windows) → Vision LLM으로 구조화 Activity 추출 → 위 fixture
// 경로와 같은 screenAdvicePolicy.evaluate로 합류한다(TODO(screen-capture-v2)였던
// 항목 해소). capture.imageBase64는 extractScreenActivity 호출 한 번에만 쓰이고
// 그 뒤로는 어떤 변수에도 저장하지 않는다 — 이 함수가 반환하는 순간 스코프를
// 벗어나 GC 대상이 된다(AGENTS.md: 화면 캡처 원본은 영구 저장하지 않는다).
async function runLiveCapture(container: CliContainer, focusMode: boolean, now: Date): Promise<string> {
  // 집중 모드는 조언뿐 아니라 그 조언을 위한 화면 수집 자체를 중단한다.
  // 원격 Provider에는 이미지 Privacy Gateway가 준비될 때까지 원본 화면을 보내지
  // 않는다. sensitiveContentDetected는 모델 응답이라 전송 전 보호 수단이 아니다.
  if (focusMode) {
    return "조언하지 않습니다.\n이유: 집중 모드에서는 화면을 캡처하지 않습니다.";
  }
  if (container.llmConfig?.provider === "remote-job") {
    return "원격 화면 분석은 개인정보 보호 처리가 준비되지 않아 사용할 수 없습니다. 로컬 Ollama를 사용하세요.";
  }

  let capture: Awaited<ReturnType<CliContainer["captureLiveScreen"]>>;
  try {
    capture = await container.captureLiveScreen();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return `실시간 화면 캡처에 실패했습니다: ${reason}`;
  }

  if (container.llmProvider === undefined) {
    return [
      "실시간 화면 캡처 완료.",
      `크기: ${capture.byteLength} bytes, 시각: ${capture.capturedAt.toISOString()}`,
      "화면 분석용 LLM이 설정되지 않아 활동 요약과 조언을 생성할 수 없습니다.",
    ].join("\n");
  }

  const extraction = await extractScreenActivity({
    imageBase64: capture.imageBase64,
    observedAt: capture.capturedAt,
    provider: container.llmProvider,
  });

  if (extraction.outcome === "sensitive_content") {
    return "화면에 민감한 내용이 감지되어 조언하지 않습니다.";
  }
  if (extraction.outcome === "remote_provider_blocked") {
    return "원격 화면 분석은 개인정보 보호 처리가 준비되지 않아 사용할 수 없습니다. 로컬 Ollama를 사용하세요.";
  }
  if (extraction.outcome === "failed") {
    return "화면 활동을 인식하지 못했습니다(Vision 분석 실패 또는 낮은 확신도).";
  }

  const contextItems = await container.repository.listContextItems();
  const decision = await container.screenAdvicePolicy.evaluate({
    activity: extraction.activity,
    contextItems,
    now,
    focusMode,
  });
  return renderDecision(decision);
}
