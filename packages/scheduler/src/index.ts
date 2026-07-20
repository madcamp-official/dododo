import type { Notifier, Recommendation } from "../../shared/src/index.ts";

export * from "./notificationGate.ts";
export * from "./quietHours.ts";
export * from "./suppress.ts";
export * from "./syncStatus.ts";

// MVP는 콘솔 출력만 한다 — OS 알림 라이브러리(예: node-notifier)를 추가하지 않는다.
// 이유: root package.json에 runtime dependency가 아직 하나도 없고 AGENTS.md가
// 불필요한 의존성 추가 전 목적·대안 설명을 요구하며, docs/architecture.md도
// "알림 전송"만 명시할 뿐 OS 알림을 특정하지 않는다. Notifier가 이미 인터페이스라
// 나중에 OS 알림 Provider를 추가해도 이 계약 자체는 바뀌지 않는다.
export class ConsoleNotifier implements Notifier {
  async send(recommendation: Recommendation): Promise<void> {
    console.log(`[notification] ${recommendation.action} — ${recommendation.reason} (id: ${recommendation.contextItemId})`);
  }
}
