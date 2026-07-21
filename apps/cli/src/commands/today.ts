import { emptyProfile, type CliContainer } from "../runtime/container.ts";
import { isSnoozed } from "../runtime/snooze.ts";

export async function renderToday(container: CliContainer, now: Date = new Date()): Promise<string> {
  const tasks = await container.repository.listContextItems("task");
  const events = await container.repository.listContextItems("event");
  const items = [...tasks, ...events];

  if (items.length === 0) {
    return [
      "Today",
      "",
      "표시할 Task/Event가 없습니다. `npm start -- sync`를 먼저 실행하세요.",
    ].join("\n");
  }

  const profile = (await container.profileRepository.get()) ?? emptyProfile();
  const recommendations = await container.recommendationEngine.recommend(items, profile, now);
  const itemsById = new Map(items.map((item) => [item.id, item]));

  const lines = ["Today", ""];
  let index = 1;
  for (const recommendation of recommendations) {
    const item = itemsById.get(recommendation.contextItemId);
    if (item === undefined || isSnoozed(item, now)) continue;

    lines.push(`${index}. [${Math.round(recommendation.score)}] ${item.title}`);
    lines.push(`   ${recommendation.reason}`);
    // ID가 없으면 이 목록에서 본 항목을 task/evidence 명령으로 다시 조회할 방법이
    // 없다 — inbox/calendar는 이미 ID를 보여주는데 today만 번호(1. 2. 3.)뿐이라
    // 빠져 있었다(실제 사용 중 발견된 버그).
    lines.push(`   ID: ${item.id}`);
    index += 1;
  }

  return lines.join("\n");
}
