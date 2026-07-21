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

// doyeonid 리뷰(PR #61): 이전엔 new Date(year, month, ...)/getTimezoneOffset()으로
// 시스템 로컬 시간대에 암묵적으로 의존했다 — 실행 환경이 UTC면 같은 입력도 다른
// 시각으로 저장돼, Asia/Seoul을 기본으로 쓰는 캘린더 조회(context.ts/calendar.ts)와
// 어긋났다(AGENTS.md: 시간 로직은 시스템 로컬 시간에 암묵적으로 의존하지 않는다).
// 데스크톱 앱 전체가 Asia/Seoul(DST 없는 고정 UTC+09:00) 하나만 다루므로, 존재
// 여부 검증은 Date.UTC(시스템 시간대 영향 없음)로 하고 오프셋은 문자열로 고정
// 부착한다 — 시스템 Date의 로컬 getter를 전혀 거치지 않아 실행 환경 TZ와 무관하다.
// scheduleItem.ts(task:update)가 같은 조합 규칙을 재사용한다 — 날짜·시간 폼 입력을
// ISO로 합치는 로직은 add/update 양쪽에서 동일해야 한다.
const FIXED_TIME_ZONE_OFFSET = "+09:00"; // Asia/Seoul

export function combineLocalDateTime(dateStr: string, timeStr: string): string | undefined {
  const dateMatch = DATE_PATTERN.exec(dateStr);
  const timeMatch = TIME_PATTERN.exec(timeStr);
  if (dateMatch === null || timeMatch === null) return undefined;

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  if (hour > 23 || minute > 59) return undefined;

  // Date.UTC는 "2월 30일" 같은 값을 조용히 3월로 굴린다 — 조합한 결과가 요청한 값과
  // 같은지 왕복 비교해야 존재하지 않는 날짜를 걸러낼 수 있다. UTC getter만 쓰므로
  // 이 검증 자체는 실행 환경 시간대와 무관하다.
  const utc = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) {
    return undefined;
  }

  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${dateStr}T${pad(hour)}:${pad(minute)}:00${FIXED_TIME_ZONE_OFFSET}`;
}
