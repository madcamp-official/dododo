const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function emptyProfile() {
  return {
    school: "",
    major: "",
    year: "",
    interests: [],
    activityTypes: [],
    preferredLocations: [],
    explicitConstraints: [],
  };
}

export function profileToForm(profile) {
  const value = profile ?? emptyProfile();
  return {
    school: value.school,
    major: value.major,
    year: value.year,
    interests: value.interests.join(", "),
    activityTypes: value.activityTypes.join(", "),
    preferredLocations: value.preferredLocations.join(", "),
    explicitConstraints: value.explicitConstraints.join(", "),
    quietHoursEnabled: value.quietHours !== undefined,
    quietHoursStart: value.quietHours?.start ?? "22:00",
    quietHoursEnd: value.quietHours?.end ?? "07:00",
  };
}

export function profileFromFormData(data) {
  const read = (name) => data.get(name)?.toString().trim() ?? "";
  const profile = {
    school: read("school"),
    major: read("major"),
    year: read("year"),
    interests: splitList(read("interests")),
    activityTypes: splitList(read("activityTypes")),
    preferredLocations: splitList(read("preferredLocations")),
    explicitConstraints: splitList(read("explicitConstraints")),
  };

  if (data.get("quietHoursEnabled") !== null) {
    const start = read("quietHoursStart");
    const end = read("quietHoursEnd");
    if (!TIME_PATTERN.test(start) || !TIME_PATTERN.test(end)) {
      throw new Error("방해 금지 시간의 시작과 종료 시각을 확인해주세요.");
    }
    return { ...profile, quietHours: { start, end } };
  }
  return profile;
}

export function splitList(value) {
  return [...new Set(value.split(/[,\n]/).map((entry) => entry.trim()).filter(Boolean))];
}
