import type { ContextItem } from "../../../../packages/shared/src/index.ts";
import { RuleBasedRecommendationEngine } from "../../../../packages/context-engine/src/index.ts";
import { emptyProfile, type CliContainer } from "./container.ts";
import { isSnoozed } from "./snooze.ts";

export interface RankedItem {
  item: ContextItem;
  score: number;
  reason: string;
}

// today.ts와 inbox.ts가 각자 구현하던 "추천엔진 순위 계산 + Snooze 제외" 루프를
// 하나로 합친다 — apps/desktop의 IPC 핸들러도 같은 결과를 구조화 데이터로 그대로
// 재사용한다(문자열로 렌더링하는 CLI와 원본 데이터가 갈리지 않는다).
export async function rankItems(
  container: CliContainer,
  items: ContextItem[],
  now: Date,
): Promise<RankedItem[]> {
  if (items.length === 0) return [];

  const profile = (await container.profileRepository.get()) ?? emptyProfile();
  // today/inbox는 사용자가 직접 연 조회 화면이다. 알림 발송용 engine에는 최근 30분
  // 중복 억제 이력이 들어 있으므로 이를 그대로 쓰면 방금 알림으로 보낸 모든 항목이
  // 목록에서도 사라진다. 조회에서는 상태·Snooze 정책만 유지하고 알림 이력은 제외한다.
  const recommendations = await new RuleBasedRecommendationEngine().recommend(items, profile, now);
  const itemsById = new Map(items.map((item) => [item.id, item]));

  const ranked: RankedItem[] = [];
  for (const recommendation of recommendations) {
    const item = itemsById.get(recommendation.contextItemId);
    if (item === undefined || isSnoozed(item, now)) continue;
    ranked.push({ item, score: recommendation.score, reason: recommendation.reason });
  }
  return ranked;
}
