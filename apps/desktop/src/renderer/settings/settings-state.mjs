export const SETTINGS_TABS = Object.freeze(["profile", "schedule", "calendar", "source"]);

export function normalizeSettingsTab(value) {
  return SETTINGS_TABS.includes(value) ? value : "profile";
}

export function settingsTabTitle(tab) {
  return ({ profile: "프로필", schedule: "일정 관리", calendar: "캘린더", source: "Source 관리" })[
    normalizeSettingsTab(tab)
  ];
}

export function scheduleInputFromFormData(data, kind = "event") {
  const optional = (name) => data.get(name)?.toString().trim() || undefined;
  return {
    title: data.get("title")?.toString().trim() ?? "",
    date: data.get("date")?.toString() ?? "",
    time: data.get("time")?.toString() ?? "",
    ...(kind === "event" ? { endTime: optional("endTime") } : {}),
    location: optional("location"),
  };
}
