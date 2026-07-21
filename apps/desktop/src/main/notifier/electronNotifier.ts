import { Notification } from "electron";

import type { ContextRepository, Notifier, Recommendation } from "../../../../../packages/shared/src/index.ts";
import { broadcastNotification } from "./broadcast.ts";
import { classifyRecommendation } from "./classifyNotification.ts";

// packages/scheduler의 Notifier 계약을 그대로 구현한다(osNotifier.ts의 WindowsOsNotifier와
// 같은 자리) — watch/watchTick.ts는 이 구현 세부를 모르고 container.notifier.send()만 호출한다.
export class ElectronDesktopNotifier implements Notifier {
  private readonly repository: ContextRepository;

  constructor(repository: ContextRepository) {
    this.repository = repository;
  }

  async send(recommendation: Recommendation): Promise<void> {
    console.log(
      `[notification] ${recommendation.action} — ${recommendation.reason} (id: ${recommendation.contextItemId})`,
    );

    const item = await this.repository.findContextItem(recommendation.contextItemId);
    const event = classifyRecommendation(item, recommendation);
    if (event !== undefined) {
      // opportunity는 "조용한 알림"(배지만) — OS 토스트 없이 IPC push만 한다.
      broadcastNotification(event);
      return;
    }

    // 아직 kind를 정확히 분류할 수 없는 추천(task/event)은 최소한 OS Notification으로
    // 놓치지 않게 한다(CLI --os-notify와 동등한 최소 동작).
    this.showOsNotification(recommendation.action, recommendation.reason);
  }

  private showOsNotification(title: string, body: string): void {
    if (!Notification.isSupported()) return;
    try {
      new Notification({ title, body }).show();
    } catch (error) {
      console.error(`[notification] OS 알림 표시 실패, 콘솔 로그로만 대체됩니다: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
