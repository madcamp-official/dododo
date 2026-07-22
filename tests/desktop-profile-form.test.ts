import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Renderer 브라우저에서 직접 실행하는 JavaScript 모듈이다.
import { emptyProfile, profileFromFormData, profileToForm, splitList } from "../apps/desktop/src/renderer/character/profile-form.mjs";

test("빈 프로필은 모든 필수 필드와 배열을 제공한다", () => {
  assert.deepEqual(emptyProfile(), {
    school: "", major: "", year: "", interests: [], activityTypes: [],
    preferredLocations: [], explicitConstraints: [],
  });
});

test("프로필 배열과 Quiet Hours를 폼 값으로 변환한다", () => {
  const form = profileToForm({
    school: "KAIST", major: "CS", year: "3학년",
    interests: ["AI", "창업"], activityTypes: ["해커톤"], preferredLocations: ["교내"],
    explicitConstraints: ["대학원생 전용 제외"], quietHours: { start: "22:00", end: "07:00" },
  });
  assert.equal(form.interests, "AI, 창업");
  assert.equal(form.quietHoursEnabled, true);
  assert.equal(form.quietHoursStart, "22:00");
});

test("폼 입력은 중복을 제거한 배열과 선택한 Quiet Hours로 변환된다", () => {
  const data = new FormData();
  data.set("school", " KAIST ");
  data.set("major", " CS ");
  data.set("year", " 3학년 ");
  data.set("interests", "AI, 창업, AI");
  data.set("activityTypes", "해커톤\n공모전");
  data.set("preferredLocations", "교내");
  data.set("explicitConstraints", "");
  data.set("quietHoursEnabled", "on");
  data.set("quietHoursStart", "22:00");
  data.set("quietHoursEnd", "07:00");

  assert.deepEqual(profileFromFormData(data), {
    school: "KAIST", major: "CS", year: "3학년", interests: ["AI", "창업"],
    activityTypes: ["해커톤", "공모전"], preferredLocations: ["교내"], explicitConstraints: [],
    quietHours: { start: "22:00", end: "07:00" },
  });
});

test("Quiet Hours를 끄면 시각 값이 있어도 저장하지 않는다", () => {
  const data = new FormData();
  data.set("school", "KAIST");
  data.set("major", "CS");
  data.set("year", "3학년");
  data.set("quietHoursStart", "22:00");
  data.set("quietHoursEnd", "07:00");
  assert.equal(profileFromFormData(data).quietHours, undefined);
});

test("Quiet Hours 시각 형식이 잘못되면 저장하지 않는다", () => {
  const data = new FormData();
  data.set("school", "KAIST");
  data.set("major", "CS");
  data.set("year", "3학년");
  data.set("quietHoursEnabled", "on");
  data.set("quietHoursStart", "25:00");
  data.set("quietHoursEnd", "07:00");
  assert.throws(() => profileFromFormData(data), /시작과 종료 시각/);
});

test("학교·전공·학년 중 하나라도 비어 있으면 저장하지 않는다", () => {
  for (const missing of ["school", "major", "year"]) {
    const data = new FormData();
    data.set("school", missing === "school" ? "   " : "KAIST");
    data.set("major", missing === "major" ? "" : "CS");
    data.set("year", missing === "year" ? "" : "3학년");
    assert.throws(() => profileFromFormData(data), /학교, 전공, 학년/);
  }
});

test("쉼표와 줄바꿈 목록은 빈 값과 중복을 제거한다", () => {
  assert.deepEqual(splitList("AI, 창업\nAI, , 공모전"), ["AI", "창업", "공모전"]);
});
