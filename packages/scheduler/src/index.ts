import type { Notifier, Recommendation } from "../../shared/src/index.ts";

export * from "./notificationGate.ts";
export * from "./osNotifier.ts";
export * from "./quietHours.ts";
export * from "./suppress.ts";
export * from "./syncStatus.ts";

// 기본은 콘솔 출력이다 — node-notifier 같은 새 npm 의존성은 추가하지 않는다(root
// package.json에 runtime dependency가 아직 없고, AGENTS.md가 새 의존성 전 목적·대안
// 설명을 요구함). 실제 OS 알림이 필요하면 osNotifier.ts의 WindowsOsNotifier를 쓴다 —
// PowerShell을 셸 없이(spawn 배열 인자) 호출해 새 의존성 없이 Windows 토스트를
// 띄운다. `watch --os-notify`가 이걸로 교체한다. Notifier가 이미 인터페이스라 이
// 계약 자체는 바뀌지 않는다.
export class ConsoleNotifier implements Notifier {
  async send(recommendation: Recommendation): Promise<void> {
    console.log(`[notification] ${recommendation.action} — ${recommendation.reason} (id: ${recommendation.contextItemId})`);
  }
}
