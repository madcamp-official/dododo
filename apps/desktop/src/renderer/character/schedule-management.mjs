const DEFAULT_TIME_ZONE = "Asia/Seoul";

export function groupScheduledItems(entries, timeZone = DEFAULT_TIME_ZONE) {
  const groups = [];
  const byKey = new Map();
  for (const entry of entries) {
    const date = new Date(entry.at);
    const valid = !Number.isNaN(date.getTime());
    const key = valid ? dateKey(date, timeZone) : "invalid";
    let group = byKey.get(key);
    if (group === undefined) {
      group = {
        key,
        label: valid ? dateLabel(date, timeZone) : "날짜 확인 필요",
        entries: [],
      };
      byKey.set(key, group);
      groups.push(group);
    }
    group.entries.push(entry);
  }
  return groups;
}

function dateKey(date, timeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date);
}

function dateLabel(date, timeZone) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone, month: "long", day: "numeric", weekday: "short",
  }).format(date);
}
