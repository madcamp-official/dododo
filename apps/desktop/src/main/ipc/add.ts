import { randomUUID } from "node:crypto";

import type { ContextItem } from "../../../../../packages/shared/src/index.ts";
import type { CliContainer } from "../../../../cli/src/runtime/container.ts";
import { fail, toResult, type Result } from "./result.ts";
import { isValidOffsetMinutes } from "./validate.ts";

export interface AddSubmitInput {
  title: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  endTime?: string; // HH:mm
  location?: string;
  reminderOffsetMinutes?: number;
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^(\d{2}):(\d{2})$/;

// CLI의 add.ts는 자연어를 파싱하지만(parseScheduleIntent), 여기는 폼이 이미 구조화된
// 값을 주므로 파싱이 필요 없다(docs/frontend-plan.md 1.2) — 날짜·시간 필드를 그대로
// 조합해 저장한다. 확인 절차([y/N/edit])는 폼 자체가 대신한다(제출 전 Renderer가
// 보여주는 것으로 간주) — 여기서 다시 사용자 확인을 받지 않는다.
export async function submitAdd(
  container: CliContainer,
  input: AddSubmitInput,
  now: Date = new Date(),
): Promise<Result<{ id: string }>> {
  const title = input.title.trim();
  if (title === "") return fail("validation", "제목을 입력해주세요.");

  const startAt = combineLocalDateTime(input.date, input.time);
  if (startAt === undefined) return fail("validation", `날짜·시각이 올바르지 않습니다: ${input.date} ${input.time}`);

  let endAt: string | undefined;
  if (input.endTime !== undefined && input.endTime.trim() !== "") {
    endAt = combineLocalDateTime(input.date, input.endTime);
    if (endAt === undefined) return fail("validation", `종료 시각이 올바르지 않습니다: ${input.endTime}`);
    if (Date.parse(endAt) <= Date.parse(startAt)) {
      return fail("validation", "종료 시각은 시작 시각보다 뒤여야 합니다.");
    }
  }

  if (input.reminderOffsetMinutes !== undefined && !isValidOffsetMinutes(input.reminderOffsetMinutes)) {
    return fail("validation", `reminderOffsetMinutes는 0 이상의 정수(분)여야 합니다: ${input.reminderOffsetMinutes}`);
  }

  return toResult(async () => {
    const id = `ctx-add-${randomUUID()}`;
    const event: ContextItem = {
      id,
      kind: "event",
      title,
      status: "confirmed",
      startAt,
      ...(endAt === undefined ? {} : { endAt }),
      requirements: [],
      tags: [],
      priority: 0,
      confidence: 1,
      evidenceIds: [],
      metadata: {
        addedViaNaturalLanguage: true,
        ...(input.location === undefined || input.location.trim() === "" ? {} : { location: input.location.trim() }),
        ...(input.reminderOffsetMinutes === undefined ? {} : { reminderOffsetMinutes: input.reminderOffsetMinutes }),
      },
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    await container.repository.saveContextItems([event]);
    return { id };
  });
}

// scheduleIntent.ts(packages/context-engine, 김도현 소유)의 private toLocalIso와 같은
// 규칙(시스템 로컬 시간 + offset)을 쓰지만, 그 함수는 export되지 않고 상대 날짜 파싱
// 로직과 얽혀 있어 이 작은 조합 하나 때문에 계약을 확장하지 않는다 — 여기서 독립적으로
// 다시 구현한다(AGENTS.md: 필요한 최소한만, 이 정도 중복은 계약 변경보다 저렴하다).
function combineLocalDateTime(dateStr: string, timeStr: string): string | undefined {
  const dateMatch = DATE_PATTERN.exec(dateStr);
  const timeMatch = TIME_PATTERN.exec(timeStr);
  if (dateMatch === null || timeMatch === null) return undefined;

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  if (hour > 23 || minute > 59) return undefined;

  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  // Date는 "2월 30일" 같은 값을 조용히 3월로 굴린다 — 조합한 결과가 요청한 값과
  // 같은지 왕복 비교해야 존재하지 않는 날짜를 걸러낼 수 있다.
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return undefined;
  }

  return toLocalIso(date);
}

function toLocalIso(date: Date): string {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}:${pad(date.getMinutes())}:00`
    + `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}
