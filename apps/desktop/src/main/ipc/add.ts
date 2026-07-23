import { randomUUID } from "node:crypto";

import { parseScheduleIntentWithLlmFallback } from "../../../../../packages/context-engine/src/index.ts";
import type { ContextItem } from "../../../../../packages/shared/src/index.ts";
import type { CliContainer } from "../../../../cli/src/runtime/container.ts";
import { fail, ok, toResult, type Result } from "./result.ts";
import { isValidOffsetMinutes } from "./validate.ts";

export interface AddSubmitInput {
  title: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  endTime?: string; // HH:mm
  location?: string;
  reminderOffsetMinutes?: number;
}

export interface ParsedScheduleDraft {
  title: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  endTime?: string; // HH:mm
  // 확신도가 낮은 시각(예: "저녁", "이따")이나 이미 지난 시각으로 해석된 경우에만
  // 채워진다 — Renderer가 폼을 채운 뒤에도 "확인 후 저장하라"는 안내를 보여줄 수 있게.
  ambiguousNote?: string;
}

// 자연어 문장을 CLI add.ts와 같은 parseScheduleIntentWithLlmFallback으로 해석해
// 폼 필드(date/time/endTime)로 변환한다. 여기서 바로 저장하지 않고 draft만 돌려주는
// 이유: AGENTS.md는 모호한 일정을 사용자 확인 없이 확정하지 않는다 — CLI는
// [y/N/edit] 프롬프트로 확인받지만, Desktop은 이미 있는 구조화 폼(submitAdd)에
// 값을 채워 넣어 사용자가 그대로 보고 수정한 뒤 제출하게 하는 방식으로 같은
// 확인 절차를 만족시킨다(별도 저장 경로를 새로 만들지 않는다).
export async function parseNaturalLanguageSchedule(
  container: CliContainer,
  utterance: string,
  now: Date = new Date(),
): Promise<Result<ParsedScheduleDraft>> {
  const trimmed = utterance.trim();
  if (trimmed === "") return fail("validation", "일정 내용을 입력해주세요.");

  let intent;
  try {
    intent = await parseScheduleIntentWithLlmFallback(
      trimmed,
      now,
      container.llmProvider,
      container.privacyGateway,
    );
  } catch (error) {
    return fail("unknown", error instanceof Error ? error.message : String(error));
  }

  if (intent.kind === "unrecognized") {
    return fail(
      "unrecognized",
      "일정 내용을 이해하지 못했습니다. 날짜와 시각을 더 구체적으로 적어주세요. 예: \"이번 주 금요일 저녁에 민수랑 저녁 약속\"",
    );
  }

  const start = isoToFormParts(intent.startAt);
  if (start === undefined) return fail("unknown", "파싱된 일정의 날짜·시각 형식이 올바르지 않습니다.");
  const end = intent.endAt === undefined ? undefined : isoToFormParts(intent.endAt)?.time;

  return ok({
    title: intent.title,
    date: start.date,
    time: start.time,
    ...(end === undefined ? {} : { endTime: end }),
    ...(intent.ambiguousField === undefined
      ? {}
      : { ambiguousNote: "시각이 정확하지 않을 수 있어요. 아래 값을 확인한 뒤 저장해주세요." }),
  });
}

// combineDateTime/toLocalIso(scheduleIntent.ts)가 만드는 형식(YYYY-MM-DDTHH:mm:00±HH:MM)을
// 그대로 앞부분만 잘라 쓴다 — 데스크톱 앱은 Asia/Seoul 하나만 다루므로(add.ts
// FIXED_TIME_ZONE_OFFSET과 동일 전제) 타임존 변환 없이 문자열 그대로가 곧 폼이
// 기대하는 로컬 날짜·시각이다.
function isoToFormParts(iso: string): { date: string; time: string } | undefined {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso);
  if (match === null) return undefined;
  return { date: match[1]!, time: match[2]! };
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
