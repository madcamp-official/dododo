import type { UserProfile } from "../../shared/src/index.ts";

const DEFAULT_TIMEZONE = "Asia/Seoul";

interface QuietWindow {
  startMinutes: number;
  endMinutes: number;
}

// quietHours가 없거나 형식이 잘못되면 항상 false를 반환한다(fail open) — 설정 오류로
// 알림이 통째로 막히는 것보다 알림이 새는 쪽이 안전하다.
export function isWithinQuietHours(
  profile: UserProfile,
  now: Date,
  timeZone: string = DEFAULT_TIMEZONE,
): boolean {
  const window = parseWindow(profile.quietHours);
  if (window === undefined) return false;

  const nowMinutes = minutesOfDay(now, timeZone);
  return isWraparound(window)
    ? nowMinutes >= window.startMinutes || nowMinutes < window.endMinutes
    : nowMinutes >= window.startMinutes && nowMinutes < window.endMinutes;
}

// 현재 Quiet Hours 구간 안에 있을 때만 의미가 있다(isWithinQuietHours가 true인 경우).
// quietHours가 없으면 호출자 실수이므로 던진다.
export function nextQuietHoursEnd(
  profile: UserProfile,
  now: Date,
  timeZone: string = DEFAULT_TIMEZONE,
): Date {
  const window = parseWindow(profile.quietHours);
  if (window === undefined) {
    throw new Error("nextQuietHoursEnd는 quietHours가 설정된 profile에서만 호출할 수 있습니다");
  }

  const parts = dateParts(now, timeZone);
  const nowMinutes = parts.hour * 60 + parts.minute;
  const wraps = isWraparound(window);
  const dayOffset = wraps && nowMinutes >= window.startMinutes ? 1 : 0;

  return zonedDate(parts.year, parts.month, parts.day, dayOffset, window.endMinutes, timeZone, now);
}

// setup 같은 입력 단계에서 "HH:mm" 형식을 즉시 검증할 때 쓴다(parseHHMM 재사용).
export function isValidClockTime(value: string): boolean {
  return parseHHMM(value) !== undefined;
}

function parseWindow(quietHours: UserProfile["quietHours"]): QuietWindow | undefined {
  if (quietHours === undefined) return undefined;
  const startMinutes = parseHHMM(quietHours.start);
  const endMinutes = parseHHMM(quietHours.end);
  if (startMinutes === undefined || endMinutes === undefined || startMinutes === endMinutes) {
    return undefined;
  }
  return { startMinutes, endMinutes };
}

function parseHHMM(value: string): number | undefined {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (match === null) return undefined;
  return Number(match[1]) * 60 + Number(match[2]);
}

function isWraparound(window: QuietWindow): boolean {
  return window.startMinutes > window.endMinutes;
}

function minutesOfDay(date: Date, timeZone: string): number {
  const { hour, minute } = dateParts(date, timeZone);
  return hour * 60 + minute;
}

function dateParts(
  date: Date,
  timeZone: string,
): { year: number; month: number; day: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string): number => Number(parts.find((part) => part.type === type)?.value ?? "0");
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute") };
}

// timeZone의 UTC 오프셋(분)을 구한다. Asia/Seoul은 DST가 없어 날짜와 무관하게
// 고정값이지만, 함수는 특정 존을 하드코딩하지 않고 Intl에서 구한다.
function utcOffsetMinutes(date: Date, timeZone: string): number {
  const part = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortOffset" })
    .formatToParts(date)
    .find((p) => p.type === "timeZoneName");
  const match = /GMT([+-]\d{1,2})(?::(\d{2}))?/.exec(part?.value ?? "");
  if (match === null) return 0;
  const hours = Number(match[1]);
  const minutes = match[2] === undefined ? 0 : Number(match[2]);
  return hours * 60 + Math.sign(hours) * minutes;
}

function zonedDate(
  year: number,
  month: number,
  day: number,
  dayOffset: number,
  minutesOfDayValue: number,
  timeZone: string,
  referenceForOffset: Date,
): Date {
  const offset = utcOffsetMinutes(referenceForOffset, timeZone);
  // Date.UTC는 month/day/minute 오버플로를 자동 정규화하므로 day+dayOffset,
  // minute=minutesOfDayValue(0~1439 초과 가능)를 그대로 넘겨도 안전하다.
  const fakeUtcMs = Date.UTC(year, month - 1, day + dayOffset, 0, minutesOfDayValue);
  return new Date(fakeUtcMs - offset * 60_000);
}
