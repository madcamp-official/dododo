const DEFAULT_TIME_ZONE = "Asia/Seoul";

export function groupScheduledItems(entries, timeZone = DEFAULT_TIME_ZONE) {
  const groups = [];
  const byKey = new Map();
  for (const entry of entries) {
    const date = new Date(entry.at);
    // calendar:get이 잘못된 at을 경계에서 제외한다. 직접 호출에서도 같은 계약을
    // 유지해 실제로 표시될 수 없는 "날짜 확인 필요" 그룹을 만들지 않는다.
    if (Number.isNaN(date.getTime())) continue;
    const key = dateKey(date, timeZone);
    let group = byKey.get(key);
    if (group === undefined) {
      group = {
        key,
        label: dateLabel(date, timeZone),
        entries: [],
      };
      byKey.set(key, group);
      groups.push(group);
    }
    group.entries.push(entry);
  }
  return groups;
}

export function buildWeeklyCalendar(entries, timeZone = DEFAULT_TIME_ZONE) {
  return groupScheduledItems(
    [...entries].sort((left, right) => new Date(left.at).getTime() - new Date(right.at).getTime()),
    timeZone,
  ).map((group) => ({
    ...group,
    entries: group.entries.map((entry) => ({
      ...entry,
      timeLabel: timeLabel(new Date(entry.at), timeZone),
    })),
  }));
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

function timeLabel(date, timeZone) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone, hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(date);
}
