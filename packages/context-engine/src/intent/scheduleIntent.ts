// 자연어 일정 입력을 Event 초안으로 파싱한다. 날짜·시각 계산은 전부 코드로 한다 —
// LLM은 "이번 주 금요일" 같은 상대 날짜 산술에 취약하고, 모호한 시각을 임의로 확정하면
// 안 되기 때문이다(AGENTS.md: 모호한 날짜·시간은 사용자 확인 없이 확정하지 않는다).
export type ScheduleIntentResult =
  | {
      kind: "event_draft";
      title: string;
      startAt: string;
      ambiguousField?: "time";
      clarifyingQuestion: string;
      evidenceQuote: string;
    }
  | { kind: "unrecognized" };

// "약속/미팅/회의/일정/모임/약속있어" 등 일정성 신호가 있어야 일정 추가로 본다.
const SCHEDULE_SIGNAL = /(약속|미팅|회의|일정|모임|만나|보기로|예약)/;

const WEEKDAYS: Record<string, number> = {
  일: 0, 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6,
};

export function parseScheduleIntent(utterance: string, now: Date): ScheduleIntentResult {
  if (!SCHEDULE_SIGNAL.test(utterance)) return { kind: "unrecognized" };

  const date = resolveDate(utterance, now);
  if (date === undefined) return { kind: "unrecognized" };

  const time = resolveTime(utterance);
  if (time === undefined) return { kind: "unrecognized" };
  const startAt = combineDateTime(date, time.hour, time.minute);
  const title = extractTitle(utterance);

  const readable = formatReadable(startAt);
  if (time.ambiguous) {
    return {
      kind: "event_draft",
      title,
      startAt,
      ambiguousField: "time",
      clarifyingQuestion: `${title}을(를) ${readable}으로 저장할까요? 시각이 정확하지 않다면 알려주세요. [y/N/edit]`,
      evidenceQuote: utterance,
    };
  }

  return {
    kind: "event_draft",
    title,
    startAt,
    clarifyingQuestion: `${title}을(를) ${readable}으로 저장할까요? [y/N/edit]`,
    evidenceQuote: utterance,
  };
}

interface ResolvedTime {
  hour: number;
  minute: number;
  ambiguous: boolean;
}

// 상대 날짜를 now 기준으로 계산한다. 지원: 오늘/내일/모레, 이번 주·다음 주 X요일,
// 단독 X요일(다가오는 날), N월 N일, N일(이번 달).
function resolveDate(utterance: string, now: Date): Date | undefined {
  const base = startOfDay(now);

  if (/모레/.test(utterance)) return addDays(base, 2);
  if (/내일/.test(utterance)) return addDays(base, 1);
  if (/오늘/.test(utterance)) return base;

  const monthDay = /(\d{1,2})\s*월\s*(\d{1,2})\s*일/.exec(utterance);
  if (monthDay !== null) {
    const month = Number(monthDay[1]) - 1;
    const day = Number(monthDay[2]);
    const candidate = localDate(base.getFullYear(), month, day);
    if (candidate === undefined) return undefined;
    return candidate < base
      ? localDate(base.getFullYear() + 1, month, day)
      : candidate;
  }

  // 단일 글자(일/월/화/...)는 "일정", "3월" 같은 흔한 단어에도 들어가므로
  // 반드시 "요일" 접미사가 있는 표현만 요일로 해석한다.
  const weekdayMatch = /(다음\s*주|이번\s*주)?\s*([일월화수목금토])요일/.exec(utterance);
  if (weekdayMatch !== null) {
    const targetDow = WEEKDAYS[weekdayMatch[2]!]!;
    const nextWeek = weekdayMatch[1] !== undefined && /다음/.test(weekdayMatch[1]);
    let delta: number;
    if (nextWeek) {
      // 주의 시작은 월요일로 정의한다. 먼저 다음 달력 주의 월요일로 이동한 뒤
      // 목표 요일 offset을 더해야 토요일의 "다음 주 금요일"이 다다음 주로 밀리지 않는다.
      const daysUntilNextMonday = ((8 - base.getDay()) % 7) || 7;
      const offsetFromMonday = (targetDow + 6) % 7;
      delta = daysUntilNextMonday + offsetFromMonday;
    } else {
      delta = (targetDow - base.getDay() + 7) % 7;
    }
    return addDays(base, delta);
  }

  const dayOnly = /(\d{1,2})\s*일/.exec(utterance);
  if (dayOnly !== null) {
    const day = Number(dayOnly[1]);
    const thisMonth = localDate(base.getFullYear(), base.getMonth(), day);
    if (thisMonth !== undefined && thisMonth >= base) return thisMonth;

    const nextMonthSeed = new Date(base);
    nextMonthSeed.setDate(1);
    nextMonthSeed.setMonth(nextMonthSeed.getMonth() + 1);
    return localDate(nextMonthSeed.getFullYear(), nextMonthSeed.getMonth(), day);
  }

  return undefined;
}

// 시각을 파싱한다. "19시"/"오후 7시"는 명확, "저녁"/"오전"처럼 대략적 표현은 기본값을
// 쓰되 ambiguous=true로 표시해 확인을 받게 한다.
function resolveTime(utterance: string): ResolvedTime | undefined {
  const explicit = /(오전|오후|아침|저녁|밤|낮)?\s*(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분)?/.exec(utterance);
  if (explicit !== null) {
    let hour = Number(explicit[2]);
    const minute = explicit[3] !== undefined ? Number(explicit[3]) : 0;
    const meridiem = explicit[1];
    if (minute < 0 || minute > 59) return undefined;
    if (meridiem !== undefined) {
      if (hour < 1 || hour > 12) return undefined;
    } else if (hour < 0 || hour > 23) {
      return undefined;
    }
    if ((meridiem === "오후" || meridiem === "저녁" || meridiem === "밤") && hour < 12) hour += 12;
    if (meridiem === "오전" && hour === 12) hour = 0;
    return { hour, minute, ambiguous: false };
  }

  // 시각 숫자 없이 대략적 시간대만 있는 경우: 기본값 + 모호 표시.
  if (/저녁/.test(utterance)) return { hour: 19, minute: 0, ambiguous: true };
  if (/점심|정오/.test(utterance)) return { hour: 12, minute: 0, ambiguous: true };
  if (/아침/.test(utterance)) return { hour: 9, minute: 0, ambiguous: true };
  if (/오후/.test(utterance)) return { hour: 15, minute: 0, ambiguous: true };
  if (/오전/.test(utterance)) return { hour: 10, minute: 0, ambiguous: true };
  if (/밤/.test(utterance)) return { hour: 21, minute: 0, ambiguous: true };

  // 시간 표현이 전혀 없으면 종일 일정으로 보되 시각 확인이 필요하다.
  return { hour: 9, minute: 0, ambiguous: true };
}

// 날짜·시각 표현과 흔한 어미를 걷어낸 나머지를 제목으로 쓴다.
function extractTitle(utterance: string): string {
  const cleaned = utterance
    .replace(/(다음\s*주|이번\s*주)/g, " ")
    .replace(/[일월화수목금토]요일/g, " ")
    .replace(/(오늘|내일|모레)/g, " ")
    .replace(/\d{1,2}\s*월\s*\d{1,2}\s*일/g, " ")
    .replace(/\d{1,2}\s*일/g, " ")
    .replace(/(오전|오후|아침|점심|저녁|밤|낮|정오)?\s*\d{1,2}\s*시(\s*\d{1,2}\s*분)?/g, " ")
    // 시간대 표현이 조사 "에"와 함께 오면(날짜를 수식하는 부사구) 제거한다. "저녁 약속"처럼
    // 조사 없이 명사를 수식하는 경우는 제목의 일부이므로 남긴다.
    .replace(/(오전|오후|아침|점심|저녁|밤|낮|정오)\s*에/g, " ")
    .replace(/(있어|있음|잡아줘|추가해줘|해줘|이야|예요|입니다|에)\s*$/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > 0 ? cleaned : "새 일정";
}

function combineDateTime(date: Date, hour: number, minute: number): string {
  const result = new Date(date);
  result.setHours(hour, minute, 0, 0);
  return toLocalIso(result);
}

function formatReadable(iso: string): string {
  const date = new Date(iso);
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${month}월 ${day}일 ${hh}:${mm}`;
}

function startOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function localDate(year: number, month: number, day: number): Date | undefined {
  if (!Number.isInteger(month) || month < 0 || month > 11 || !Number.isInteger(day) || day < 1 || day > 31) {
    return undefined;
  }
  const candidate = new Date(0);
  candidate.setHours(0, 0, 0, 0);
  candidate.setFullYear(year, month, day);
  return candidate.getFullYear() === year && candidate.getMonth() === month && candidate.getDate() === day
    ? candidate
    : undefined;
}

// 시스템 타임존 기준 로컬 ISO 문자열(offset 포함). UTC로 밀리면 날짜가 하루 어긋날 수
// 있어, 주입된 now와 같은 로컬 기준을 유지한다.
function toLocalIso(date: Date): string {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}:${pad(date.getMinutes())}:00`
    + `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}
