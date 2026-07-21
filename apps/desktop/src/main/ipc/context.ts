import type { CliContainer } from "../../../../cli/src/runtime/container.ts";
import { rankItems, type RankedItem } from "../../../../cli/src/runtime/recommendationRanking.ts";
import { getWeekSchedule, type ScheduledItem } from "../../../../cli/src/commands/calendar.ts";
import { toResult, type Result } from "./result.ts";

const DEFAULT_TIME_ZONE = "Asia/Seoul";

// today.ts/inbox.ts(CLI 문자열 렌더링)와 같은 rankItems를 그대로 재사용한다 —
// "오늘 할일" 요약 발화(docs/frontend-plan.md 1.4)와 패널이 같은 데이터를 쓴다.
export async function getToday(
  container: CliContainer,
  now: Date = new Date(),
): Promise<Result<{ items: RankedItem[] }>> {
  return toResult(async () => {
    const tasks = await container.repository.listContextItems("task");
    const events = await container.repository.listContextItems("event");
    return { items: await rankItems(container, [...tasks, ...events], now) };
  });
}

export async function getInbox(
  container: CliContainer,
  now: Date = new Date(),
): Promise<Result<{ items: RankedItem[] }>> {
  return toResult(async () => {
    const opportunities = await container.repository.listContextItems("opportunity");
    return { items: await rankItems(container, opportunities, now) };
  });
}

export async function getCalendar(
  container: CliContainer,
  now: Date = new Date(),
  timeZone: string = DEFAULT_TIME_ZONE,
): Promise<Result<{ items: ScheduledItem[] }>> {
  return toResult(async () => ({ items: await getWeekSchedule(container, now, timeZone) }));
}
