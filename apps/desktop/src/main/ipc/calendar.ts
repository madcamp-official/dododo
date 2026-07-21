import type { CliContainer } from "../../../../cli/src/runtime/container.ts";
import { listWeekSchedule, type ScheduledEntry } from "../../../../cli/src/commands/calendar.ts";
import { runResult, type Result } from "./result.ts";

export interface CalendarGetResponse {
  entries: ScheduledEntry[];
}

export async function getCalendarWeek(
  container: CliContainer,
  now: Date = new Date(),
): Promise<Result<CalendarGetResponse>> {
  return runResult(async () => {
    const entries = await listWeekSchedule(container, now);
    return { entries };
  });
}
