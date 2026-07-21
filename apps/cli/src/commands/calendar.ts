import type { ContextItem } from "../../../../packages/shared/src/index.ts";
import { isExcludedContextStatus } from "../../../../packages/context-engine/src/index.ts";
import type { CliContainer } from "../runtime/container.ts";

const USAGE = "사용법: dododo calendar week";
const DEFAULT_TIME_ZONE = "Asia/Seoul";

export interface ScheduledEntry {
  item: ContextItem;
  at: string;
}

export async function listWeekSchedule(
  container: CliContainer,
  now: Date = new Date(),
  timeZone: string = DEFAULT_TIME_ZONE,
): Promise<ScheduledEntry[]> {
  const items = await container.repository.listContextItems();
  const weekKeys = calendarWeekKeys(now, timeZone);
  return items
    .flatMap((item) => {
      if (isExcludedContextStatus(item.status)) return [];
      const at = scheduledValue(item);
      if (at === undefined || Number.isNaN(Date.parse(at))) return [];
      return [{ item, at }];
    })
    .filter(({ at }) => weekKeys.has(dateKey(new Date(at), timeZone)))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

export async function runCalendar(
  container: CliContainer,
  args: string[],
  now: Date = new Date(),
  timeZone: string = DEFAULT_TIME_ZONE,
): Promise<string> {
  if (args.length !== 1 || args[0] !== "week") return USAGE;

  const scheduled = await listWeekSchedule(container, now, timeZone);

  const lines = ["Calendar — 이번 주", ""];
  if (scheduled.length === 0) {
    lines.push("이번 주에 등록된 일정이나 마감이 없습니다.");
    return lines.join("\n");
  }

  for (const { item, at } of scheduled) {
    lines.push(`${dateKey(new Date(at), timeZone)} ${timeLabel(new Date(at), timeZone)}  [${item.kind}] ${item.title}`);
    lines.push(`  ID: ${item.id}`);
  }
  return lines.join("\n");
}

function scheduledValue(item: ContextItem): string | undefined {
  return item.kind === "event" ? item.startAt : item.kind === "task" ? item.deadline : undefined;
}

function calendarWeekKeys(now: Date, timeZone: string): Set<string> {
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(now);
  const mondayIndex: Record<string, number> = {
    Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6,
  };
  const offset = mondayIndex[weekday];
  if (offset === undefined) throw new Error(`요일을 계산할 수 없습니다: ${weekday}`);
  const dayMs = 24 * 60 * 60 * 1000;
  // 기본 시간대 Asia/Seoul에는 DST가 없다. DST 시간대를 정식 지원할 때는 절대
  // 24시간 이동 대신 해당 시간대의 달력 날짜 연산으로 교체해야 한다.
  const monday = new Date(now.getTime() - offset * dayMs);
  return new Set(Array.from({ length: 7 }, (_, index) =>
    dateKey(new Date(monday.getTime() + index * dayMs), timeZone)
  ));
}

function dateKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function timeLabel(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}
