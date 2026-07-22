import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import test from "node:test";

// @ts-expect-error 브라우저에서 직접 실행하는 JavaScript 모듈이다.
import { normalizeSettingsTab, scheduleInputFromFormData, SETTINGS_TABS, settingsTabTitle } from "../apps/desktop/src/renderer/settings/settings-state.mjs";

test("독립 설정 Renderer 파일과 네 탭을 제공한다", async () => {
  await Promise.all([
    access("apps/desktop/src/renderer/settings/index.html"),
    access("apps/desktop/src/renderer/settings/settings.js"),
    access("apps/desktop/src/renderer/settings/style.css"),
  ]);
  const html = await readFile("apps/desktop/src/renderer/settings/index.html", "utf8");
  for (const tab of SETTINGS_TABS) assert.match(html, new RegExp(`data-settings-tab="${tab}"`));
  assert.match(html, /<nav aria-label="설정 메뉴">/);
  assert.doesNotMatch(html, /class="settings-main" aria-live/);
});

test("독립 설정 Renderer 모듈은 구문 검사를 통과한다", () => {
  for (const path of [
    "apps/desktop/src/renderer/settings/settings.js",
    "apps/desktop/src/renderer/settings/settings-state.mjs",
  ]) {
    const result = spawnSync(process.execPath, ["--check", path], { encoding: "utf8" });
    assert.equal(result.status, 0, `${path}: ${result.stderr}`);
  }
});

test("설정 탭은 허용 값만 선택하고 나머지는 프로필로 복구한다", () => {
  assert.deepEqual(SETTINGS_TABS, ["profile", "schedule", "calendar", "source"]);
  assert.equal(normalizeSettingsTab("calendar"), "calendar");
  assert.equal(normalizeSettingsTab("unknown"), "profile");
  assert.equal(settingsTabTitle("source"), "Source 관리");
});

test("일정 폼은 Event와 Task 계약에 맞는 입력을 만든다", () => {
  const data = new FormData();
  data.set("title", " 팀 회의 ");
  data.set("date", "2026-07-23");
  data.set("time", "13:00");
  data.set("endTime", "14:00");
  data.set("location", " N1 ");

  assert.deepEqual(scheduleInputFromFormData(data), {
    title: "팀 회의", date: "2026-07-23", time: "13:00", endTime: "14:00", location: "N1",
  });
  assert.deepEqual(scheduleInputFromFormData(data, "task"), {
    title: "팀 회의", date: "2026-07-23", time: "13:00", location: "N1",
  });
});

test("설정 Renderer는 기존 desktopApi와 순수 폼 모듈을 재사용한다", async () => {
  const renderer = await readFile("apps/desktop/src/renderer/settings/settings.js", "utf8");
  for (const call of [
    "profileGet", "profileSave", "calendar", "add", "detail", "update", "delete", "reminder",
    "sourceList", "sourceRegister", "sourceRemove",
  ]) assert.match(renderer, new RegExp(`desktopApi\\.${call}`));
  assert.match(renderer, /profileFromFormData/);
  assert.match(renderer, /scheduleItemToForm/);
  assert.match(renderer, /buildWeeklyCalendar/);
  assert.match(renderer, /createExclusiveActionRunner/);
  assert.match(renderer, /\[\.\.\.tabButtons, \.\.\.content\.querySelectorAll\("button, input"\)\]/);
  assert.match(renderer, /class="state-card" role="status"/);
  assert.match(renderer, /class="notice" role="status"/);
});

test("설정 Renderer는 Source 재시작 안내와 변경·삭제 확인을 제공한다", async () => {
  const renderer = await readFile("apps/desktop/src/renderer/settings/settings.js", "utf8");
  assert.match(renderer, /앱을 재시작하면 Source 설정이 적용됩니다/);
  assert.match(renderer, /기존 학교 사이트 URL을 새 주소로 대체할까요/);
  assert.match(renderer, /Source를 삭제할까요/);
  assert.match(renderer, /window\.confirm/);
});
