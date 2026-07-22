const DEFAULT_TIME_ZONE = "Asia/Seoul";

export function localDateKey(now = new Date(), timeZone = DEFAULT_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function isWithinQuietHours(profile, now = new Date(), timeZone = DEFAULT_TIME_ZONE) {
  const start = parseTime(profile?.quietHours?.start);
  const end = parseTime(profile?.quietHours?.end);
  if (start === undefined || end === undefined || start === end) return false;

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  const current = get("hour") * 60 + get("minute");
  return start > end ? current >= start || current < end : current >= start && current < end;
}

export function buildDailySummary(entries) {
  if (entries.length === 0) return "오늘은 등록된 일정이나 할 일이 없어요.";
  const titles = entries.slice(0, 2).map(({ item }) => `“${item.title}”`).join(", ");
  const remaining = entries.length - 2;
  const suffix = remaining > 0 ? ` 외 ${remaining}개` : "";
  return `오늘 확인할 일이 ${entries.length}개 있어요. ${titles}${suffix}를 살펴볼까요?`;
}

export function shouldShowDailySummary(lastShownDate, profile, now = new Date(), timeZone = DEFAULT_TIME_ZONE) {
  const today = localDateKey(now, timeZone);
  return { today, show: lastShownDate !== today && !isWithinQuietHours(profile, now, timeZone) };
}

function parseTime(value) {
  const match = /^(?:([01]\d|2[0-3])):([0-5]\d)$/.exec(value ?? "");
  return match === null ? undefined : Number(match[1]) * 60 + Number(match[2]);
}
