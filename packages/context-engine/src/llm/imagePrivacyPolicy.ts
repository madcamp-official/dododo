import type { LLMProvider } from "./provider.ts";

// AGENTS.md: 화면 캡처 원본을 개인정보 보호 처리 없이 외부로 보내지 않는다. 이미지
// 전용 Privacy Gateway(OCR 기반 사전 마스킹 등)가 아직 없는 상태에서, 원격 Provider에는
// 이미지를 아예 보내지 않는 것이 유일한 하드 방어선이다(docs/backend-next-plan.md
// "Privacy Gateway의 이미지 미대응"). 이 판단이 호출부마다(advise.ts, extractScreenActivity,
// 데스크톱 captureVisionPipeline 등) 따로 구현되면 한 곳이라도 놓쳤을 때 원본 이미지가
// 새어 나갈 수 있다 — 하나의 함수로 모아 모든 호출부가 같은 기준을 쓰게 한다.
//
// doyeonid 리뷰(PR #99) P1: imageDataBoundary가 없는(undefined) Provider를
// 예전엔 "remote만 아니면 허용"으로 fail-open 처리했다 — 새 원격 Provider 구현이
// 이 필드를 깜빡 빠뜨리면 그 순간 하드 방어선이 무력화된다. 하드 방어선이라면
// "local"이라고 명시한 경우만 허용하는 fail-closed여야 한다 — 필드 누락·오타·
// 새로운 값 전부 차단 쪽으로 안전하게 떨어진다.
export function isImageTransmissionAllowed(
  provider: Pick<LLMProvider, "imageDataBoundary"> | undefined,
): boolean {
  if (provider === undefined) return false;
  return provider.imageDataBoundary === "local";
}
