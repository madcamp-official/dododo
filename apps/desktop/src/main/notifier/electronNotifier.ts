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
    // Desktop 알림은 종류와 관계없이 Renderer의 캐릭터 말풍선으로만 전달한다.
    // CLI의 --os-notify 구현(packages/scheduler)은 별도라 영향을 받지 않는다.
    broadcastNotification(event);
  }
}
