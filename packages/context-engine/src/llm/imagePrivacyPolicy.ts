import type { LLMProvider } from "./provider.ts";

// AGENTS.md: 화면 캡처 원본을 개인정보 보호 처리 없이 외부로 보내지 않는다. 이미지
// 전용 Privacy Gateway(OCR 기반 사전 마스킹 등)가 아직 없는 상태에서, 원격 Provider에는
// 이미지를 아예 보내지 않는 것이 유일한 하드 방어선이다(docs/backend-next-plan.md
// "Privacy Gateway의 이미지 미대응"). 이 판단이 호출부마다(advise.ts, extractScreenActivity,
// 데스크톱 captureVisionPipeline 등) 따로 구현되면 한 곳이라도 놓쳤을 때 원본 이미지가
// 새어 나갈 수 있다 — 하나의 함수로 모아 모든 호출부가 같은 기준을 쓰게 한다.
export function isImageTransmissionAllowed(
  provider: Pick<LLMProvider, "imageDataBoundary"> | undefined,
): boolean {
  if (provider === undefined) return false;
  return provider.imageDataBoundary !== "remote";
}
