// 자연어 일정 입력을 Event 초안으로 파싱한다. 날짜·시각 계산은 전부 코드로 한다 —
// LLM은 "이번 주 금요일" 같은 상대 날짜 산술에 취약하고, 모호한 시각을 임의로 확정하면
// 안 되기 때문이다(AGENTS.md: 모호한 날짜·시간은 사용자 확인 없이 확정하지 않는다).
export type ScheduleIntentResult =
  | {
      kind: "event_draft";
      title: string;
      startAt: string;
      endAt?: string;
      ambiguousField?: "time";
      clarifyingQuestion: string;
      evidenceQuote: string;
    }
  | { kind: "unrecognized" };

// "약속/미팅/회의/일정" 같은 명시적 일정 어휘 외에, 실제로 자주 쓰이는 약속·모임·업무
// 어휘를 넓게 허용한다. 그래도 전체 게이트를 없애지 않는 이유: 날짜·시각 조각(예:
// "3일 동안 여행했어"의 "3일")이 우연히 매치되는 문장까지 전부 일정으로 오인하면 안 되기
// 때문이다(AGENTS.md: 모호한 일정을 확인 없이 확정하지 않는다 — 게이트가 좁을 때는
// 그냥 "못 알아들음"으로 안전하게 떨어진다).
const SCHEDULE_SIGNAL = /(약속|미팅|회의|일정|모임|만나|보기로|가기로|예약|뒤풀이|상담|면담|세미나|워크숍|발표|수업|강의|시험|통화|전화|식사|밥|저녁|점심|아침|커피|술자리|파티|여행|출장|병원|진료|스터디|과외|면접)/;

const WEEKDAYS: Record<string, number> = {
  일: 0, 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6,
};

// 과거 표현이 있으면 "약속이 있었다"처럼 이미 지난 일을 서술하는 문장일 수 있다. 과거
// 날짜 계산은 지원하지 않으므로, 미래 일정으로 잘못 확정하는 대신 못 알아들음으로
// 떨어뜨린다(A-3 "날짜 없으면 오늘로 기본값" 폴백이 이런 문장까지 삼키지 않도록 함).
const PAST_REFERENCE = /(어제|그제|지난\s*주|지난달|저번\s*주|저번\s*달)/;

// 반복 일정을 domain.ts에 아직 표현할 수 없어(recurrence 필드 없음, 공동 소유 계약
// 변경 필요) 이번 회차 하나만 저장한다. 조용히 "매주"를 무시하고 1회성으로 저장하면
// 사용자가 반복 등록된 줄 알고 다음 주는 확인하지 않는 사고로 이어지므로, 저장 여부를
// 묻는 문장에 명시적으로 경고를 남긴다.
const RECURRENCE_SIGNAL = /(매주|매일|매달|매월|격주|반복)/;

// resolveDate가 시도하는 트리거 토큰들의 존재 여부만 본다(실제 유효성 검증은 하지
// 않는다). "날짜 표현이 아예 없음"과 "날짜 표현은 있었는데 무효함(예: 2월 30일)"을
// 구분하는 용도 — 후자는 오늘로 조용히 대체하면 안 된다. 사용자가 명시한 날짜가
// 잘못됐다면 그 오류를 그대로 드러내 못 알아들음으로 떨어뜨려야 한다.
const DATE_EXPRESSION_PRESENT =
  /(글피|모레|내일|오늘|\d{4}[-.]\d{1,2}[-.]\d{1,2}|(다음|이번)\s*달\s*\d{1,2}\s*일|\d{1,2}\s*월\s*\d{1,2}\s*일|\d{1,2}\s*\/\s*\d{1,2}|[일월화수목금토](?:요일|욜)|주말|\d{1,2}\s*일)/;

export function parseScheduleIntent(utterance: string, now: Date): ScheduleIntentResult {
  if (!SCHEDULE_SIGNAL.test(utterance)) return { kind: "unrecognized" };
  if (PAST_REFERENCE.test(utterance)) return { kind: "unrecognized" };

  const relative = resolveRelativeOffset(utterance, now);
  let date = relative !== undefined ? startOfDay(relative.at) : resolveDate(utterance, now);
  // 날짜 표현이 아예 없어도 시각이 명시적이면("3시에 미팅") 오늘로 본다. 날짜 표현을
  // 시도했지만 무효한 경우(2월 30일)나 시각까지 명시적이지 않은 경우(예: "약속 일정
  // 하나 추가해줘")는 근거가 너무 얕거나 사용자 입력 자체가 잘못된 것이므로 그대로
  // 못 알아들음으로 떨어뜨린다 — 날짜·시각 둘 다 없는 문장을 오늘 09:00로 확정하거나,
  // 잘못된 날짜를 조용히 다른 날로 바꿔 저장하면 안 된다(AGENTS.md).
  if (
    date === undefined && relative === undefined
    && !DATE_EXPRESSION_PRESENT.test(utterance) && hasExplicitTimeToken(utterance)
  ) {
    date = startOfDay(now);
  }
  if (date === undefined) return { kind: "unrecognized" };

  // 범위 표현을 시도했는데 무효한 경우(끝이 시작보다 빠름, 자정을 넘는 범위)는
  // "범위 없음"과 구분해야 한다 — 구분하지 않으면 상위 로직이 resolveTime()으로
  // 문장 전체를 다시 훑어 범위의 시작 시각만 골라내고, 사용자가 명시한 끝 시각은
  // 조용히 버려진다(PR #49 리뷰, doyeonid 지적).
  const range = resolveTimeRange(utterance);
  if (range.kind === "invalid") return { kind: "unrecognized" };

  const time = relative !== undefined
    ? { hour: relative.at.getHours(), minute: relative.at.getMinutes(), ambiguous: relative.ambiguous }
    : (range.kind === "valid" ? range.start : resolveTime(utterance));
  if (time === undefined) return { kind: "unrecognized" };

  const startAt = combineDateTime(date, time.hour, time.minute);
  const endAt = range.kind === "valid" ? combineDateTime(date, range.end.hour, range.end.minute) : undefined;
  const title = extractTitle(utterance);

  // 날짜가 없어 오늘로 기본 처리했거나("3시에 미팅") 막연한 미래 표현("이따") 뒤에
  // 비-meridiem 시각("6시")이 오면, 그 시각이 이미 지난 시각일 수 있다("이따 6시"가
  // 오후 15:20 시점에 06:00으로 풀리는 식). 이미 지난 시각을 모호 표시 없이 확정하면
  // "이따"의 미래 의도와 모순되므로, 이미 지났으면 확신도와 무관하게 확인을 받는다
  // (PR #49 리뷰, doyeonid 지적).
  const isAlreadyPast = new Date(startAt).getTime() < now.getTime();
  const ambiguous = time.ambiguous || isAlreadyPast;

  const readable = formatReadable(startAt, endAt);
  const recurrenceNote = RECURRENCE_SIGNAL.test(utterance)
    ? " 반복 일정은 아직 지원하지 않아 이번 한 번만 저장합니다."
    : "";

  if (ambiguous) {
    const reason = isAlreadyPast
      ? "이미 지난 시각일 수 있어 확인이 필요합니다."
      : "시각이 정확하지 않다면 알려주세요.";
    return {
      kind: "event_draft",
      title,
      startAt,
      ...(endAt === undefined ? {} : { endAt }),
      ambiguousField: "time",
      clarifyingQuestion: `${title}을(를) ${readable}으로 저장할까요? ${reason}${recurrenceNote} [y/N/edit]`,
      evidenceQuote: utterance,
    };
  }

  return {
    kind: "event_draft",
    title,
    startAt,
    ...(endAt === undefined ? {} : { endAt }),
    clarifyingQuestion: `${title}을(를) ${readable}으로 저장할까요?${recurrenceNote} [y/N/edit]`,
    evidenceQuote: utterance,
  };
}

interface ResolvedTime {
  hour: number;
  minute: number;
  ambiguous: boolean;
}

// "30분 뒤에 전화", "1시간 후 통화"처럼 지금 시각 기준 상대 오프셋을 표현하는 문장은
// 날짜·시각 표현이 아예 따로 없어 resolveDate/resolveTime로는 처리할 수 없다. 여기서
// 먼저 감지해 now에 직접 오프셋을 더한다. 숫자가 없는 막연한 "이따"류는 오프셋을
// 확정할 수 없으므로 기본값(2시간 뒤)을 쓰되 ambiguous=true로 확인을 받는다.
const RELATIVE_NUMERIC_OFFSET = /(\d{1,2})\s*(분|시간)\s*(뒤|후)(?:에)?/;
const RELATIVE_VAGUE = /(이따가|이따|잠시\s*후에?|조금\s*있다가)/;

function resolveRelativeOffset(utterance: string, now: Date): { at: Date; ambiguous: boolean } | undefined {
  const numeric = RELATIVE_NUMERIC_OFFSET.exec(utterance);
  if (numeric !== null) {
    const amount = Number(numeric[1]);
    const unitMs = numeric[2] === "시간" ? 60 * 60 * 1000 : 60 * 1000;
    return { at: new Date(now.getTime() + amount * unitMs), ambiguous: false };
  }

  // "이따 6시에"처럼 막연한 표현 뒤에 실제 시각이 따로 명시되면, 그 명시적 시각을
  // 우선해야 한다("이따"를 2시간 뒤 기본값으로 확정하면 "6시"라는 실제 정보를 버리게
  // 된다). 이 경우 undefined를 반환해 일반 날짜·시각 해석 경로(오늘 기본값 + 명시
  // 시각)로 넘긴다.
  if (RELATIVE_VAGUE.test(utterance) && !hasExplicitTimeToken(utterance)) {
    return { at: new Date(now.getTime() + 2 * 60 * 60 * 1000), ambiguous: true };
  }

  return undefined;
}

function hasExplicitTimeToken(utterance: string): boolean {
  return /\d{1,2}:\d{2}/.test(utterance) || EXPLICIT_TIME.test(utterance);
}

// 상대 날짜를 now 기준으로 계산한다. 지원: 오늘/내일/모레/글피, 주말, 이번 주·다음 주(담주)
// X요일(욜), 단독 X요일(다가오는 날), 이번 달·다음 달 N일, N월 N일, M/D, YYYY-MM-DD, N일(이번 달).
function resolveDate(utterance: string, now: Date): Date | undefined {
  const base = startOfDay(now);

  if (/글피/.test(utterance)) return addDays(base, 3);
  if (/모레/.test(utterance)) return addDays(base, 2);
  if (/내일/.test(utterance)) return addDays(base, 1);
  if (/오늘/.test(utterance)) return base;

  const isoDate = /(\d{4})[-.](\d{1,2})[-.](\d{1,2})/.exec(utterance);
  if (isoDate !== null) {
    return localDate(Number(isoDate[1]), Number(isoDate[2]) - 1, Number(isoDate[3]));
  }

  const relativeMonthDay = /(다음|이번)\s*달\s*(\d{1,2})\s*일/.exec(utterance);
  if (relativeMonthDay !== null) {
    const monthOffset = relativeMonthDay[1] === "다음" ? 1 : 0;
    const day = Number(relativeMonthDay[2]);
    const targetMonthIndex = base.getMonth() + monthOffset;
    const year = base.getFullYear() + Math.floor(targetMonthIndex / 12);
    const month = ((targetMonthIndex % 12) + 12) % 12;
    return localDate(year, month, day);
  }

  const monthDay = /(\d{1,2})\s*월\s*(\d{1,2})\s*일/.exec(utterance)
    ?? slashMonthDay(utterance);
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
  // 반드시 "요일"·구어체 "욜" 접미사가 있는 표현만 요일로 해석한다.
  const weekdayMatch = /(다음\s*주|이번\s*주|담주)?\s*([일월화수목금토])(?:요일|욜)/.exec(utterance);
  if (weekdayMatch !== null) {
    const targetDow = WEEKDAYS[weekdayMatch[2]!]!;
    const nextWeek = weekdayMatch[1] !== undefined && (weekdayMatch[1] === "담주" || /다음/.test(weekdayMatch[1]));
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

  if (/주말/.test(utterance)) {
    // 토요일을 기준으로 삼는다. 오늘이 이미 토요일이면 오늘, 일요일이면 다음 토요일.
    const daysUntilSaturday = (6 - base.getDay() + 7) % 7;
    return addDays(base, daysUntilSaturday);
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

// "8/15"처럼 슬래시로 구분한 월/일. "2026/8/15"처럼 연도가 붙은 표현은 URL·분수 등과
// 헷갈릴 수 있어 지원하지 않는다 — 필요하면 ISO(YYYY-MM-DD) 표현을 쓰도록 안내한다.
function slashMonthDay(utterance: string): RegExpExecArray | null {
  return /(\d{1,2})\s*\/\s*(\d{1,2})(?!\s*\/)/.exec(utterance);
}

// 시각을 파싱한다. "19시"/"오후 7시"/"2시 반"/"14:00"은 명확, "저녁"/"오전"처럼 대략적
// 표현은 기본값을 쓰되 ambiguous=true로 표시해 확인을 받게 한다.
function resolveTime(utterance: string): ResolvedTime | undefined {
  const colon = /(\d{1,2}):(\d{2})/.exec(utterance);
  if (colon !== null) {
    const hour = Number(colon[1]);
    const minute = Number(colon[2]);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return undefined;
    return { hour, minute, ambiguous: false };
  }

  const explicit = EXPLICIT_TIME.exec(utterance);
  if (explicit !== null) {
    const parsed = interpretExplicitTime({
      meridiem: explicit[1],
      hourText: explicit[2]!,
      minuteText: explicit[3],
      half: explicit[4] !== undefined,
    });
    if (parsed === undefined) return undefined;
    return { ...parsed, ambiguous: false };
  }

  // 시각 숫자 없이 대략적 시간대만 있는 경우: 기본값 + 모호 표시.
  if (/저녁/.test(utterance)) return { hour: 19, minute: 0, ambiguous: true };
  if (/점심|정오/.test(utterance)) return { hour: 12, minute: 0, ambiguous: true };
  if (/아침/.test(utterance)) return { hour: 9, minute: 0, ambiguous: true };
  if (/새벽/.test(utterance)) return { hour: 5, minute: 0, ambiguous: true };
  if (/오후/.test(utterance)) return { hour: 15, minute: 0, ambiguous: true };
  if (/오전/.test(utterance)) return { hour: 10, minute: 0, ambiguous: true };
  if (/밤/.test(utterance)) return { hour: 21, minute: 0, ambiguous: true };

  // 시간 표현이 전혀 없으면 종일 일정으로 보되 시각 확인이 필요하다.
  return { hour: 9, minute: 0, ambiguous: true };
}

// 시간대 단어를 여기 한 곳에서만 정의한다. EXPLICIT_TIME·TIME_TOKEN_SOURCE·
// resolveTimeRange의 시간대 상속 판정·extractTitle이 전부 이 상수를 공유한다 —
// 예전에는 이 목록이 4곳에 따로 하드코딩돼 있었고, 그중 EXPLICIT_TIME/TIME_TOKEN_SOURCE
// 두 곳에만 "새벽"이 빠져 있어서 "밤 11시부터 새벽 1시까지"가 범위로 전혀 인식되지
// 않고(TIME_RANGE 매치 자체가 실패해 "범위 없음"으로 오판) 자정 넘는 범위 거부 로직을
// 아예 타지 못하는 버그가 있었다(PR #49 리뷰, dotori235 지적). 하나로 합쳐서 같은
// 종류의 누락이 다시 생기지 않게 한다.
const MERIDIEM_SOURCE = "오전|오후|아침|새벽|저녁|밤|낮";

// meridiem, hour, minuteDigits, half("반") 네 그룹.
const EXPLICIT_TIME = new RegExp(`(${MERIDIEM_SOURCE})?\\s*(\\d{1,2})\\s*시(?:\\s*(\\d{1,2})\\s*분|\\s*(반))?`);

interface ExplicitTimeGroups {
  meridiem: string | undefined;
  hourText: string;
  minuteText: string | undefined;
  half: boolean;
}

function interpretExplicitTime(groups: ExplicitTimeGroups): { hour: number; minute: number } | undefined {
  let hour = Number(groups.hourText);
  const minute = groups.half ? 30 : groups.minuteText !== undefined ? Number(groups.minuteText) : 0;
  const meridiem = groups.meridiem;
  if (minute < 0 || minute > 59) return undefined;
  if (meridiem !== undefined) {
    if (hour < 1 || hour > 12) return undefined;
  } else if (hour < 0 || hour > 23) {
    return undefined;
  }
  if ((meridiem === "오후" || meridiem === "저녁" || meridiem === "밤") && hour < 12) hour += 12;
  if (meridiem === "오전" && hour === 12) hour = 0;
  return { hour, minute };
}

// "오후 2시부터 4시까지"처럼 시작·끝 시각을 함께 표현하면 endAt까지 채운다.
// 시작·끝 각각 한국어(N시, 오전/오후 N시, N시 반, N시 M분) 또는 콜론(HH:MM) 형식을
// 허용하고, 구분자는 "부터" 또는 "~"이며 "까지"는 있어도 없어도 된다 — "까지"를
// 필수로 두면 "오후 2시~4시", "14:00~16:00"처럼 흔한 표현이 범위로 인식되지 않고
// 조용히 시작 시각만으로 축소된다(PR #49 리뷰, doyeonid 지적: "일반적인 시간 범위
// 입력의 종료 시각을 조용히 버립니다"). 자정을 넘기는 범위(예: "밤 11시부터
// 새벽 1시까지")는 지원하지 않고 unrecognized로 떨어뜨린다.
const TIME_TOKEN_SOURCE =
  `(?:${MERIDIEM_SOURCE})?\\s*(?:\\d{1,2}\\s*시(?:\\s*\\d{1,2}\\s*분|\\s*반)?|\\d{1,2}:\\d{2})`;
const TIME_RANGE = new RegExp(
  `(${TIME_TOKEN_SOURCE})\\s*(?:부터|~)\\s*(${TIME_TOKEN_SOURCE})\\s*(?:까지)?`,
);

// "범위 표현이 아예 없음"(none)과 "범위 표현은 있었지만 해석할 수 없음"(invalid)을
// 구분한다. 후자를 그냥 undefined로 뭉뚱그리면 호출부가 "범위 없음"으로 오인해
// resolveTime()으로 문장 전체를 다시 훑어 시작 시각만 골라내고, 사용자가 명시한 끝
// 시각은 조용히 사라진다(PR #49 리뷰).
type TimeRangeResolution =
  | { kind: "none" }
  | { kind: "invalid" }
  | { kind: "valid"; start: ResolvedTime; end: ResolvedTime };

function resolveTimeRange(utterance: string): TimeRangeResolution {
  const match = TIME_RANGE.exec(utterance);
  if (match === null) return { kind: "none" };

  const startText = match[1]!;
  let endText = match[2]!;

  // 끝 시각에 별도 오전/오후 표기가 없고 콜론 형식(이미 24시간제라 모호하지 않음)도
  // 아니면 시작 시각의 시간대를 물려받는다 — "오후 2시~4시"의 4시가 새벽 4시일 리는
  // 없기 때문이다.
  const startMeridiem = new RegExp(`^(${MERIDIEM_SOURCE})`).exec(startText)?.[1];
  const endHasOwnMeridiem = new RegExp(`^(${MERIDIEM_SOURCE})`).test(endText);
  const endIsColon = endText.includes(":");
  if (startMeridiem !== undefined && !endHasOwnMeridiem && !endIsColon) {
    endText = `${startMeridiem} ${endText}`;
  }

  const start = parseTimeToken(startText);
  const end = parseTimeToken(endText);
  if (start === undefined || end === undefined) return { kind: "invalid" };

  const startMinutes = start.hour * 60 + start.minute;
  const endMinutes = end.hour * 60 + end.minute;
  // 자정을 넘는 범위("밤 11시부터 1시까지")도 여기서 끝<=시작으로 걸린다 — 지원하지
  // 않는 범위이므로 "범위 없음"이 아니라 "무효한 범위"로 다뤄 unrecognized로
  // 떨어뜨린다(끝 시각을 조용히 버리고 시작 시각만 쓰지 않는다).
  if (endMinutes <= startMinutes) return { kind: "invalid" };

  return { kind: "valid", start: { ...start, ambiguous: false }, end: { ...end, ambiguous: false } };
}

function parseTimeToken(text: string): { hour: number; minute: number } | undefined {
  const colon = /(\d{1,2}):(\d{2})/.exec(text);
  if (colon !== null) {
    const hour = Number(colon[1]);
    const minute = Number(colon[2]);
    return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 ? { hour, minute } : undefined;
  }
  const explicit = EXPLICIT_TIME.exec(text);
  if (explicit === null) return undefined;
  return interpretExplicitTime({
    meridiem: explicit[1],
    hourText: explicit[2]!,
    minuteText: explicit[3],
    half: explicit[4] !== undefined,
  });
}

// 날짜·시각·범위·반복 표현과 흔한 어미를 걷어낸 나머지를 제목으로 쓴다.
function extractTitle(utterance: string): string {
  const cleaned = utterance
    .replace(RELATIVE_NUMERIC_OFFSET, " ")
    .replace(RELATIVE_VAGUE, " ")
    .replace(/(다음\s*주|이번\s*주|담주)/g, " ")
    .replace(/(다음|이번)\s*달/g, " ")
    .replace(RECURRENCE_SIGNAL, " ")
    .replace(/[일월화수목금토](?:요일|욜)/g, " ")
    .replace(/(글피|모레|내일|오늘)/g, " ")
    .replace(/\d{4}[-.]\d{1,2}[-.]\d{1,2}/g, " ")
    .replace(/\d{1,2}\s*월\s*\d{1,2}\s*일/g, " ")
    .replace(/\d{1,2}\s*\/\s*\d{1,2}/g, " ")
    .replace(/\d{1,2}\s*일/g, " ")
    .replace(/주말/g, " ")
    .replace(TIME_RANGE, " ")
    .replace(EXPLICIT_TIME, " ")
    .replace(/\d{1,2}:\d{2}/g, " ")
    // 시간대 표현이 조사 "에"와 함께 오면(날짜를 수식하는 부사구) 제거한다. "저녁 약속"처럼
    // 조사 없이 명사를 수식하는 경우는 제목의 일부이므로 남긴다.
    .replace(new RegExp(`(${MERIDIEM_SOURCE}|점심|정오)\\s*에`, "g"), " ")
    // 위 패턴들을 제거하고 나면 "3시에 치과 예약"의 "에"처럼 문장 중간에 조사만 홀로
    // 남는 경우가 있다. 공백으로 둘러싸인 단독 "에/에는/까지/부터"는 남은 조사로 보고
    // 제거한다(제목 중간에 "카페" 같은 단어의 일부로 걸리지 않도록 경계를 둔다).
    .replace(/(^|\s)(에는|까지|부터|에)(?=\s|$)/g, " ")
    .replace(/(있어|있음|잡아줘|추가해줘|해줘|이야|예요|입니다)\s*$/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > 0 ? cleaned : "새 일정";
}

function combineDateTime(date: Date, hour: number, minute: number): string {
  const result = new Date(date);
  result.setHours(hour, minute, 0, 0);
  return toLocalIso(result);
}

function formatReadable(startIso: string, endIso: string | undefined): string {
  const date = new Date(startIso);
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  if (endIso === undefined) return `${month}월 ${day}일 ${hh}:${mm}`;

  const end = new Date(endIso);
  const endHh = String(end.getHours()).padStart(2, "0");
  const endMm = String(end.getMinutes()).padStart(2, "0");
  return `${month}월 ${day}일 ${hh}:${mm}~${endHh}:${endMm}`;
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
