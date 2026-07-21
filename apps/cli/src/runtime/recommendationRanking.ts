import type { ContextItem } from "../../../../packages/shared/src/index.ts";
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
  const recommendations = await container.recommendationEngine.recommend(items, profile, now);
  const itemsById = new Map(items.map((item) => [item.id, item]));

  const ranked: RankedItem[] = [];
  for (const recommendation of recommendations) {
    const item = itemsById.get(recommendation.contextItemId);
    if (item === undefined || isSnoozed(item, now)) continue;
    ranked.push({ item, score: recommendation.score, reason: recommendation.reason });
  }
  return ranked;
}
