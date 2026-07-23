import {
  createExclusiveActionRunner,
  desktopApi,
  formatDateTime,
  statusLabel,
  unwrapResult,
} from "../character/desktop-api.mjs";
import { profileFromFormData, profileToForm } from "../character/profile-form.mjs";
import { parseReminderOffset, scheduleItemToForm } from "../character/schedule-form.mjs";
import { buildWeeklyCalendar, groupScheduledItems } from "../character/schedule-management.mjs";
import { normalizeSettingsTab, scheduleInputFromFormData, settingsTabTitle } from "./settings-state.mjs";

const content = document.querySelector("[data-settings-content]");
const title = document.querySelector("[data-settings-title]");
const tabButtons = [...document.querySelectorAll("[data-settings-tab]")];
const runExclusive = createExclusiveActionRunner();
let activeTab = "profile";

for (const button of tabButtons) {
  button.addEventListener("click", () => void openTab(button.dataset.settingsTab));
}

void openTab("profile");

async function openTab(requestedTab) {
  activeTab = normalizeSettingsTab(requestedTab);
  title.textContent = settingsTabTitle(activeTab);
  for (const button of tabButtons) {
    const selected = button.dataset.settingsTab === activeTab;
    if (selected) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
  renderLoading();
  try {
    if (activeTab === "profile") await renderProfile();
    else if (activeTab === "schedule") await renderSchedule();
    else if (activeTab === "calendar") await renderCalendar();
    else await renderSources();
  } catch (error) {
    renderError(error);
  }
}

function renderLoading() {
  content.innerHTML = '<div class="state-card" role="status">불러오는 중...</div>';
}

function renderError(error) {
  const message = error instanceof Error ? error.message : "설정을 처리하지 못했습니다.";
  content.innerHTML = `<div class="state-card error"><strong>처리하지 못했어요</strong><p>${escapeHtml(message)}</p><button class="secondary" type="button" data-retry>다시 시도</button></div>`;
  content.querySelector("[data-retry]")?.addEventListener("click", () => void openTab(activeTab));
}

function notice(message) {
  return message === undefined ? "" : `<p class="notice" role="status">${escapeHtml(message)}</p>`;
}

async function renderProfile(message) {
  const profile = profileToForm(unwrapResult(await desktopApi.profileGet()));
  content.innerHTML = `${notice(message)}
    <form class="settings-form" data-profile-form>
      <div class="form-grid two">
        ${field("profile-school", "school", "학교", profile.school, true)}
        ${field("profile-major", "major", "전공", profile.major, true)}
      </div>
      ${field("profile-year", "year", "학년", profile.year, true, "예: 3학년")}
      ${field("profile-interests", "interests", "관심 분야", profile.interests, false, "AI, 창업")}
      ${field("profile-activities", "activityTypes", "선호 활동", profile.activityTypes, false, "해커톤, 공모전")}
      ${field("profile-locations", "preferredLocations", "선호 장소", profile.preferredLocations, false, "서울, 교내")}
      ${field("profile-constraints", "explicitConstraints", "제외 조건", profile.explicitConstraints, false, "대학원생 전용")}
      <fieldset class="quiet-hours">
        <label><input name="quietHoursEnabled" type="checkbox" ${profile.quietHoursEnabled ? "checked" : ""} data-quiet-toggle /> 방해 금지 시간 사용</label>
        <div class="form-grid two" data-quiet-fields>
          ${timeField("quiet-start", "quietHoursStart", "시작", profile.quietHoursStart)}
          ${timeField("quiet-end", "quietHoursEnd", "종료", profile.quietHoursEnd)}
        </div>
      </fieldset>
      <div class="form-actions"><button class="primary" type="submit">프로필 저장</button></div>
      <p class="hint">여러 값은 쉼표로 구분하며 추천 관련도와 방해 금지 정책에 사용됩니다.</p>
    </form>`;
  const form = content.querySelector("[data-profile-form]");
  const toggle = form?.querySelector("[data-quiet-toggle]");
  const updateQuietFields = () => {
    form?.querySelectorAll("[data-quiet-fields] input").forEach((input) => {
      input.disabled = toggle?.checked !== true;
      input.required = toggle?.checked === true;
    });
  };
  toggle?.addEventListener("change", updateQuietFields);
  updateQuietFields();
  form?.addEventListener("submit", (event) => void runProfileSave(event));
}

async function runProfileSave(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!(form instanceof HTMLFormElement)) return;
  // disabled 상태의 input은 FormData에서 제외된다. withBusy가 컨트롤을 잠그기 전에
  // 현재 입력값을 캡처해야 필수 프로필 값이 빈 문자열로 사라지지 않는다.
  const data = new FormData(form);
  await withBusy(async () => {
    const profile = profileFromFormData(data);
    unwrapResult(await desktopApi.profileSave(profile));
    await renderProfile("프로필을 저장했습니다.");
  });
}

async function renderSchedule(message) {
  const { items } = unwrapResult(await desktopApi.calendar());
  const groups = groupScheduledItems(items);
  const scheduleContent = groups.length === 0
    ? '<div class="state-card compact">이번 주에 관리할 일정이 없습니다.</div>'
    : `<div class="schedule-groups">${groups.map((group) => `<section><h2>${escapeHtml(group.label)}</h2><div class="item-list">${group.entries.map(({ item, at }) => scheduleButton(item, at)).join("")}</div></section>`).join("")}</div>`;
  content.innerHTML = `${notice(message)}<div class="toolbar"><p>이번 주 Task와 Event를 수정하거나 처리할 수 있습니다.</p><button class="primary" type="button" data-add-schedule>일정 추가</button></div>${scheduleContent}`;
  content.querySelector("[data-add-schedule]")?.addEventListener("click", renderAddSchedule);
  bindScheduleButtons();
}

function scheduleButton(item, at) {
  return `<button class="item-card" type="button" data-schedule-id="${escapeHtml(item.id)}"><span class="pill">${item.kind === "event" ? "일정" : "마감"}</span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(formatDateTime(at))} · ${escapeHtml(statusLabel(item.status))}</small></button>`;
}

function bindScheduleButtons() {
  content.querySelectorAll("[data-schedule-id]").forEach((button) => {
    button.addEventListener("click", () => void renderScheduleDetail(button.dataset.scheduleId));
  });
}

function renderAddSchedule() {
  title.textContent = "일정 추가";
  content.innerHTML = `<button class="back-button" type="button" data-back>← 일정 관리</button>${scheduleForm("추가")}`;
  content.querySelector("[data-back]")?.addEventListener("click", () => void openTab("schedule"));
  content.querySelector("[data-schedule-form]")?.addEventListener("submit", (event) => void runAddSchedule(event));
}

async function runAddSchedule(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!(form instanceof HTMLFormElement)) return;
  await withBusy(async () => {
    unwrapResult(await desktopApi.add(scheduleInputFromFormData(new FormData(form))));
    title.textContent = settingsTabTitle("schedule");
    await renderSchedule("일정을 추가했습니다.");
  });
}

async function renderScheduleDetail(id, message) {
  if (id === undefined) return;
  title.textContent = "일정 상세";
  renderLoading();
  try {
    const detail = unwrapResult(await desktopApi.detail(id));
    const { item } = detail;
    const form = scheduleItemToForm(item);
    content.innerHTML = `${notice(message)}<button class="back-button" type="button" data-back>← 일정 관리</button>
      <article class="detail-card"><span class="pill">${item.kind === "event" ? "일정" : "할 일"}</span><h2>${escapeHtml(item.title)}</h2><dl><div><dt>시간</dt><dd>${escapeHtml(formatDateTime(item.startAt ?? item.deadline))}</dd></div><div><dt>상태</dt><dd>${escapeHtml(statusLabel(item.status))}</dd></div></dl></article>
      ${scheduleForm("변경", form, item.kind)}
      <form class="inline-form" data-reminder-form><label for="settings-reminder">마감 전 알림</label><input id="settings-reminder" name="offsetMinutes" type="number" min="1" step="1" value="${escapeHtml(form.reminderOffsetMinutes ?? "")}" required /><span>분 전</span><button class="secondary" type="submit">저장</button></form>
      <button class="danger" type="button" data-delete-schedule>일정 삭제</button>`;
    content.querySelector("[data-back]")?.addEventListener("click", () => void openTab("schedule"));
    content.querySelector("[data-schedule-form]")?.addEventListener("submit", (event) => void runUpdateSchedule(event, item));
    content.querySelector("[data-reminder-form]")?.addEventListener("submit", (event) => void runReminderSave(event, item.id));
    content.querySelector("[data-delete-schedule]")?.addEventListener("click", () => void runDeleteSchedule(item));
  } catch (error) { renderError(error); }
}

async function runUpdateSchedule(event, item) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!(form instanceof HTMLFormElement)) return;
  await withBusy(async () => {
    unwrapResult(await desktopApi.update(item.id, scheduleInputFromFormData(new FormData(form), item.kind)));
    await renderScheduleDetail(item.id, "변경 내용을 저장했습니다.");
  });
}

async function runReminderSave(event, id) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!(form instanceof HTMLFormElement)) return;
  const offset = parseReminderOffset(new FormData(form).get("offsetMinutes"));
  if (offset === undefined) { renderError(new Error("알림 시간은 1분 이상의 정수로 입력해주세요.")); return; }
  await withBusy(async () => {
    unwrapResult(await desktopApi.reminder(id, offset));
    await renderScheduleDetail(id, "알림 시간을 저장했습니다.");
  });
}

async function runDeleteSchedule(item) {
  if (!window.confirm(`“${item.title}”을(를) 삭제할까요? 목록에서 숨겨지며 근거는 보존됩니다.`)) return;
  await withBusy(async () => {
    unwrapResult(await desktopApi.delete(item.id));
    title.textContent = settingsTabTitle("schedule");
    await renderSchedule("일정을 삭제했습니다.");
  });
}

async function renderCalendar() {
  const { items } = unwrapResult(await desktopApi.calendar());
  const days = buildWeeklyCalendar(items);
  content.innerHTML = days.length === 0 ? '<div class="state-card">이번 주 일정이 없습니다.</div>'
    : `<div class="weekly-calendar">${days.map((day) => `<section class="calendar-day"><header><time datetime="${escapeHtml(day.key)}">${escapeHtml(day.label)}</time><span>${day.entries.length}개</span></header><div>${day.entries.map(({ item, at, timeLabel }) => `<button type="button" data-calendar-id="${escapeHtml(item.id)}"><time datetime="${escapeHtml(at)}">${escapeHtml(timeLabel)}</time><span><strong>${escapeHtml(item.title)}</strong><small>${item.kind === "event" ? "일정" : "마감"}</small></span></button>`).join("")}</div></section>`).join("")}</div>`;
  content.querySelectorAll("[data-calendar-id]").forEach((button) => {
    button.addEventListener("click", () => void renderScheduleDetail(button.dataset.calendarId));
  });
}

async function renderSources(message) {
  const [{ sources }, { items }] = await Promise.all([
    desktopApi.sourceList().then(unwrapResult),
    desktopApi.sourceItems().then(unwrapResult),
  ]);
  const list = sources.length === 0 ? '<div class="state-card compact">등록된 Source가 없습니다.</div>'
    : `<div class="source-list">${sources.map((source) => `<article><div><strong>${escapeHtml(sourceTypeLabel(source.type))}</strong><small>${escapeHtml(source.value)}</small></div><button class="danger" type="button" data-source-remove="${escapeHtml(source.id)}" data-source-type="${escapeHtml(source.type)}">삭제</button></article>`).join("")}</div>`;
  const collectedItems = items.length === 0
    ? '<div class="state-card compact">아직 저장된 학교 사이트 수집 항목이 없습니다. URL 등록 후 앱을 재시작하고 동기화해 주세요.</div>'
    : `<div class="source-item-list">${items.map((item) => `<details class="source-item"><summary><span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(formatDateTime(item.observedAt))}</small></span></summary><div class="source-item-body"><p class="source-uri">${escapeHtml(item.uri)}</p><pre>${escapeHtml(item.content)}</pre>${item.truncated ? '<p class="hint">내용이 길어 앞부분 4,000자만 표시합니다.</p>' : ""}</div></details>`).join("")}</div>`;
  // 학교 사이트는 여러 개를 동시에 등록할 수 있다 — 폼은 항상 "추가"이고 기존 값을
  // 대체하지 않는다(같은 URL을 다시 넣으면 sourceRegistration.ts가 중복 없이 무시한다).
  content.innerHTML = `${notice(message)}${list}<form class="settings-form source-form" data-source-form><label for="settings-source-url">학교 사이트 URL</label><input id="settings-source-url" name="value" type="url" value="" placeholder="https://school.example/notices" required /><button class="primary" type="submit">학교 사이트 추가</button></form><p class="hint">학교 이메일과 LMS 등록은 필수 설정값이 확정되지 않아 아직 지원하지 않습니다.</p><section class="collected-section"><div class="toolbar"><div><h2>최근 수집 항목</h2><p>등록 URL에서 가져와 로컬에 저장한 최근 항목 ${items.length}개입니다.</p></div><button class="secondary" type="button" data-source-refresh>지금 동기화</button></div>${collectedItems}</section>`;
  content.querySelector("[data-source-form]")?.addEventListener("submit", (event) => void runSourceSave(event));
  content.querySelector("[data-source-refresh]")?.addEventListener("click", () => void runSourceRefresh());
  content.querySelectorAll("[data-source-remove]").forEach((button) => button.addEventListener("click", () => void runSourceRemove(button.dataset.sourceRemove, button.dataset.sourceType)));
}

async function runSourceRefresh() {
  await withBusy(async () => {
    unwrapResult(await desktopApi.sync());
    await renderSources("동기화를 완료하고 최근 수집 항목을 갱신했습니다.");
  });
}

async function runSourceSave(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!(form instanceof HTMLFormElement)) return;
  const value = new FormData(form).get("value")?.toString().trim() ?? "";
  await withBusy(async () => {
    unwrapResult(await desktopApi.sourceRegister("school-site", value));
    await renderSources("등록했습니다. 앱을 재시작하면 Source 설정이 적용됩니다.");
  });
}

async function runSourceRemove(id, type) {
  if (id === undefined || !window.confirm(`${sourceTypeLabel(type)} Source를 삭제할까요?`)) return;
  await withBusy(async () => {
    unwrapResult(await desktopApi.sourceRemove(id));
    await renderSources("삭제했습니다. 앱을 재시작하면 Source 설정이 적용됩니다.");
  });
}

async function withBusy(action) {
  await runExclusive(async () => {
    const controls = [...tabButtons, ...content.querySelectorAll("button, input")];
    const states = controls.map((control) => control.disabled);
    controls.forEach((control) => { control.disabled = true; });
    try { await action(); }
    catch (error) { renderError(error); }
    finally { controls.forEach((control, index) => { if (control.isConnected) control.disabled = states[index]; }); }
  });
}

function scheduleForm(action, value = {}, kind = "event") {
  return `<form class="settings-form" data-schedule-form>${field("schedule-title", "title", "제목", value.title ?? "", true)}<div class="form-grid two">${dateField("schedule-date", "date", "날짜", value.date ?? "")}${timeField("schedule-time", "time", kind === "task" ? "마감" : "시작", value.time ?? "")}</div>${kind === "event" ? timeField("schedule-end", "endTime", "종료(선택)", value.endTime ?? "", false) : ""}${field("schedule-location", "location", "장소(선택)", value.location ?? "")}<div class="form-actions"><button class="primary" type="submit">${action} 저장</button></div></form>`;
}

function field(id, name, label, value, required = false, placeholder = "") {
  return `<div class="form-field"><label for="${id}">${label}</label><input id="${id}" name="${name}" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" ${required ? "required" : ""} /></div>`;
}

function dateField(id, name, label, value) { return `<div class="form-field"><label for="${id}">${label}</label><input id="${id}" name="${name}" type="date" value="${escapeHtml(value)}" required /></div>`; }
function timeField(id, name, label, value, required = true) { return `<div class="form-field"><label for="${id}">${label}</label><input id="${id}" name="${name}" type="time" value="${escapeHtml(value)}" ${required ? "required" : ""} /></div>`; }
function sourceTypeLabel(id) { return ({ "school-site": "학교 사이트", "school-email": "학교 이메일", lms: "LMS" })[id] ?? "Source"; }
function escapeHtml(value) { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
