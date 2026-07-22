const SEOUL_TIME_ZONE = "Asia/Seoul";

export function scheduleItemToForm(item) {
  const scheduledAt = item.kind === "task" ? item.deadline : item.startAt;
  const start = dateTimeParts(scheduledAt);
  const end = item.kind === "event" ? dateTimeParts(item.endAt) : undefined;
  const location = typeof item.metadata?.location === "string" ? item.metadata.location : "";
  const reminderOffsetMinutes = Number.isSafeInteger(item.metadata?.reminderOffsetMinutes)
    && item.metadata.reminderOffsetMinutes > 0
    ? item.metadata.reminderOffsetMinutes
    : undefined;

  return {
    title: item.title,
    date: start?.date ?? "",
    time: start?.time ?? "",
    endTime: end?.time ?? "",
    location,
    reminderOffsetMinutes,
  };
}

export function parseReminderOffset(value) {
  const trimmed = String(value).trim();
  if (!/^\d+$/.test(trimmed)) return undefined;
  const offset = Number(trimmed);
  return Number.isSafeInteger(offset) && offset > 0 ? offset : undefined;
}

function dateTimeParts(value) {
  if (typeof value !== "string") return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SEOUL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  const year = get("year");
  const month = get("month");
  const day = get("day");
  const hour = get("hour");
  const minute = get("minute");
  if ([year, month, day, hour, minute].some((part) => part === undefined)) return undefined;
  return { date: `${year}-${month}-${day}`, time: `${hour}:${minute}` };
}
