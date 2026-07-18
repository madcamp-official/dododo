import { emptyProfile, type CliContainer } from "../runtime/container.ts";

export async function renderInbox(container: CliContainer, now: Date = new Date()): Promise<string> {
  const items = await container.repository.listContextItems("opportunity");

  if (items.length === 0) {
    return [
      "Opportunity Inbox",
      "",
      "등록된 Opportunity가 없습니다. `npm start -- sync`를 먼저 실행하세요.",
    ].join("\n");
  }

  const profile = (await container.profileRepository.get()) ?? emptyProfile();
  const recommendations = await container.recommendationEngine.recommend(items, profile, now);
  const itemsById = new Map(items.map((item) => [item.id, item]));

  const lines = ["Opportunity Inbox", ""];
  for (const recommendation of recommendations) {
    const item = itemsById.get(recommendation.contextItemId);
    if (item === undefined) continue;

    lines.push(`[${item.id}] 관련도 ${Math.round(recommendation.score)}  ${item.title}`);
    if (item.deadline !== undefined) lines.push(`  마감: ${item.deadline}`);
    lines.push(`  이유: ${recommendation.reason}`);
  }

  return lines.join("\n");
}
