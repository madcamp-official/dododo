import {
  createExclusiveActionRunner,
  desktopApi,
  formatDateTime,
  statusLabel,
  tomorrowAtSameTime,
  unwrapResult,
} from "../character/desktop-api.mjs";
import { parseReminderOffset, scheduleItemToForm } from "../character/schedule-form.mjs";
import { buildWeeklyCalendar } from "../character/schedule-management.mjs";

const panelTitle = document.querySelector("[data-panel-title]");
const panelContent = document.querySelector("[data-panel-content]");
const runExclusiveAction = createExclusiveActionRunner();
let currentRoute = { view: "today" };
let navigationVersion = 0;

document.querySelector("[data-close-panel]")?.addEventListener("click", () => window.close());

const unsubscribeNavigate = window.desktopWindow?.onPanelNavigate?.((route) => {
  void navigate(route);
});

window.addEventListener("beforeunload", () => unsubscribeNavigate?.(), { once: true });

async function navigate(route) {
  if (!isPanelRoute(route)) return;
  currentRoute = route;
  const version = ++navigationVersion;
  setTitle(viewTitle(route.view));
  renderLoading(route.view === "detail" ? "상세 정보를 불러오는 중..." : "불러오는 중...");

  try {
    if (route.view === "today") {
      const items = unwrapResult(await desktopApi.today()).items;
      if (version === navigationVersion) renderRankedItems(items);
    } else if (route.view === "calendar") {
      const items = unwrapResult(await desktopApi.calendar()).items;
      if (version === navigationVersion) renderCalendar(items);
    } else if (route.view === "inbox") {
      const items = unwrapResult(await desktopApi.inbox()).items;
      if (version === navigationVersion) renderRecommendations(items);
    }
    else if (route.view === "ask") renderAsk();
    else if (route.itemId !== undefined) {
      const detail = unwrapResult(await desktopApi.detail(route.itemId));
      if (version === navigationVersion) renderDetail(detail);
    }
    else throw new Error("상세보기에 필요한 항목 ID가 없습니다.");
  } catch (error) {
    if (version === navigationVersion) renderError(error);
  }
}

function isPanelRoute(route) {
  return route !== null && typeof route === "object"
    && ["today", "calendar", "inbox", "ask", "detail"].includes(route.view)
    && (route.itemId === undefined || typeof route.itemId === "string");
}

function viewTitle(view) {
  return ({ today: "오늘 할 일", calendar: "이번 주", inbox: "추천", ask: "물어보기", detail: "상세보기" })[view]
    ?? "DoDoDo";
}

function setTitle(title) {
  if (panelTitle !== null) panelTitle.textContent = title;
}

function renderLoading(message) {
  if (panelContent !== null) panelContent.innerHTML = `<div class="state-message">${escapeHtml(message)}</div>`;
}

function renderRankedItems(entries) {
  if (entries.length === 0) {
    panelContent.innerHTML = '<div class="state-message">오늘 확인할 일이 없습니다.</div>';
    return;
  }
  panelContent.innerHTML = `<div class="card-list">${entries.map(({ item, score, reason }) => `
    <button class="context-card" type="button" data-item-id="${escapeHtml(item.id)}">
      <span class="card-kind">${item.kind === "event" ? "일정" : "할 일"}</span>
      <strong>${escapeHtml(item.title)}</strong>
      <span>${escapeHtml(formatDateTime(item.startAt ?? item.deadline))}</span>
      <small>${escapeHtml(`${score}점 · ${reason} · ${statusLabel(item.status)}`)}</small>
    </button>`).join("")}</div>`;
  bindDetailButtons();
}

function renderCalendar(entries) {
  const days = buildWeeklyCalendar(entries);
  if (days.length === 0) {
    panelContent.innerHTML = '<div class="state-message">이번 주 일정이 없습니다.</div>';
    return;
  }
  panelContent.innerHTML = `<div class="weekly-calendar" aria-label="이번 주 일정">${days.map((day) => `
    <section class="calendar-day">
      <header><time datetime="${escapeHtml(day.key)}">${escapeHtml(day.label)}</time><span>${day.entries.length}개</span></header>
      <div class="calendar-day-items">${day.entries.map(({ item, at, timeLabel }) => `
        <button class="calendar-entry ${item.kind === "event" ? "event" : "deadline"}" type="button" data-item-id="${escapeHtml(item.id)}">
          <time datetime="${escapeHtml(at)}">${escapeHtml(timeLabel)}</time>
          <span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(`${item.kind === "event" ? "일정" : "마감"} · ${statusLabel(item.status)}`)}</small></span>
        </button>`).join("")}</div>
    </section>`).join("")}</div>`;
  bindDetailButtons();
}

function renderRecommendations(entries) {
  if (entries.length === 0) {
    panelContent.innerHTML = '<div class="state-message">새로운 추천이 없습니다.</div>';
    return;
  }
  panelContent.innerHTML = `<div class="card-list">${entries.map(({ item, score, reason }) => `
    <article class="context-card static-card">
      <span class="card-kind opportunity">추천</span>
      <strong>${escapeHtml(item.title)}</strong>
      <span>${escapeHtml(reason)}</span>
      <small>${escapeHtml(`${score}점 · ${formatDateTime(item.deadline)}`)}</small>
    </article>`).join("")}</div>`;
}

function renderAsk() {
  panelContent.innerHTML = `
    <form class="ask-form" data-ask-form>
      <label for="question">무엇이 궁금한가요?</label>
      <textarea id="question" name="question" rows="4" placeholder="예: 이번 주 마감은 뭐야?" required></textarea>
      <button class="primary-button" type="submit">물어보기</button>
    </form>
    <div class="answer" data-answer hidden></div>`;
  panelContent.querySelector("[data-ask-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const answer = panelContent.querySelector("[data-answer]");
    const question = new FormData(event.currentTarget).get("question")?.toString().trim() ?? "";
    if (!(answer instanceof HTMLElement) || question === "") return;
    answer.hidden = false;
    answer.textContent = "답을 찾는 중...";
    try {
      const result = unwrapResult(await desktopApi.ask(question));
      answer.textContent = `${result.answer}\n근거 ${result.evidence.length}개`;
    } catch (error) {
      answer.textContent = errorMessage(error, "질문 처리에 실패했습니다.");
    }
  });
}

function renderDetail(detail) {
  const { item, evidence, isSnoozed, snoozedUntil } = detail;
  setTitle("상세보기");
  const requirements = item.requirements.length === 0
    ? '<p class="muted">등록된 요구사항이 없습니다.</p>'
    : `<ul class="evidence-list">${item.requirements.map((value) => `<li>${escapeHtml(value)}</li>`).join("")}</ul>`;
  const evidenceContent = evidence.length === 0
    ? '<p class="muted">연결된 근거가 없습니다.</p>'
    : `<ul class="evidence-list">${evidence.map((entry) => `<li>${escapeHtml(entry.quote)}<small>${escapeHtml(`${entry.sourceType} · ${entry.location}`)}</small></li>`).join("")}</ul>`;
  const form = scheduleItemToForm(item);
  panelContent.innerHTML = `
    <article class="detail-card">
      <span class="card-kind">${item.kind === "event" ? "일정" : "할 일"}</span>
      <h2>${escapeHtml(item.title)}</h2>
      <dl>
        <div><dt>시간</dt><dd>${escapeHtml(formatDateTime(item.startAt ?? item.deadline))}</dd></div>
        <div><dt>상태</dt><dd>${escapeHtml(statusLabel(item.status))}</dd></div>
        ${isSnoozed ? `<div><dt>미룸</dt><dd>${escapeHtml(formatDateTime(snoozedUntil))}까지</dd></div>` : ""}
      </dl>
      <h3>요구사항</h3>${requirements}
      <h3>근거</h3>${evidenceContent}
      ${item.kind === "task" && item.status !== "done" ? `<div class="action-row">
        <button class="primary-button" type="button" data-complete>완료</button>
        <button class="secondary-button" type="button" data-snooze>내일 알림</button>
      </div>` : ""}
      ${item.kind === "task" || item.kind === "event" ? `<div class="management-actions">
        <button class="secondary-button" type="button" data-edit>수정</button>
        <button class="danger-button" type="button" data-delete>삭제</button>
      </div>
      <form class="reminder-form" data-reminder-form>
        <label for="reminder-offset">마감 전 알림</label>
        <div><input id="reminder-offset" name="offsetMinutes" type="number" min="1" step="1" value="${escapeHtml(form.reminderOffsetMinutes ?? "")}" placeholder="예: 60" required /><span>분 전</span><button class="secondary-button" type="submit">저장</button></div>
      </form>` : ""}
    </article>`;
  panelContent.querySelector("[data-complete]")?.addEventListener("click", () => runDetailAction(
    () => desktopApi.complete(item.id),
    item.id,
  ));
  panelContent.querySelector("[data-snooze]")?.addEventListener("click", () => runDetailAction(
    () => desktopApi.snooze(item.id, tomorrowAtSameTime()),
    item.id,
  ));
  panelContent.querySelector("[data-edit]")?.addEventListener("click", () => renderEdit(detail));
  panelContent.querySelector("[data-delete]")?.addEventListener("click", () => runDelete(item));
  panelContent.querySelector("[data-reminder-form]")?.addEventListener("submit", (event) => runReminder(event, item.id));
}

function renderEdit(detail) {
  const { item } = detail;
  const form = scheduleItemToForm(item);
  setTitle(item.kind === "task" ? "할 일 수정" : "일정 수정");
  panelContent.innerHTML = `<form class="edit-form" data-edit-form>
    <label>제목<input name="title" type="text" value="${escapeHtml(form.title)}" required /></label>
    <div class="form-row"><label>날짜<input name="date" type="date" value="${escapeHtml(form.date)}" required /></label><label>${item.kind === "task" ? "마감" : "시작"}<input name="time" type="time" value="${escapeHtml(form.time)}" required /></label></div>
    ${item.kind === "event" ? `<label>종료<input name="endTime" type="time" value="${escapeHtml(form.endTime)}" /></label>` : ""}
    <label>장소<input name="location" type="text" value="${escapeHtml(form.location)}" /></label>
    <div class="action-row"><button class="primary-button" type="submit">변경 저장</button><button class="secondary-button" type="button" data-cancel>취소</button></div>
  </form>`;
  panelContent.querySelector("[data-cancel]")?.addEventListener("click", () => renderDetail(detail));
  panelContent.querySelector("[data-edit-form]")?.addEventListener("submit", (event) => runEdit(event, item));
}

async function runEdit(event, item) {
  event.preventDefault();
  const startVersion = navigationVersion;
  const data = new FormData(event.currentTarget);
  const optional = (name) => data.get(name)?.toString().trim() || undefined;
  await runAction(async () => {
    unwrapResult(await desktopApi.update(item.id, {
      title: optional("title") ?? "", date: optional("date") ?? "", time: optional("time") ?? "",
      ...(item.kind === "event" ? { endTime: optional("endTime") } : {}), location: optional("location"),
    }));
    if (startVersion !== navigationVersion) return;
    await openDetail(item.id);
  });
}

async function runDelete(item) {
  if (!window.confirm(`'${item.title}'을(를) 삭제할까요? 목록에서는 숨겨지고 근거는 보존됩니다.`)) return;
  const startVersion = navigationVersion;
  await runAction(async () => {
    unwrapResult(await desktopApi.delete(item.id));
    if (startVersion !== navigationVersion) return;
    setTitle("삭제 완료");
    panelContent.innerHTML = '<div class="state-message success">항목을 삭제했습니다.</div>';
  });
}

async function runReminder(event, id) {
  event.preventDefault();
  const startVersion = navigationVersion;
  const offset = parseReminderOffset(new FormData(event.currentTarget).get("offsetMinutes"));
  if (offset === undefined) {
    renderError(new Error("알림 시간은 1분 이상의 정수로 입력해 주세요."));
    return;
  }
  await runAction(async () => {
    unwrapResult(await desktopApi.reminder(id, offset));
    if (startVersion !== navigationVersion) return;
    await openDetail(id);
  });
}

async function runDetailAction(action, id) {
  const startVersion = navigationVersion;
  await runAction(async () => {
    unwrapResult(await action());
    if (startVersion !== navigationVersion) return;
    await openDetail(id);
  });
}

async function openDetail(itemId) {
  currentRoute = { view: "detail", itemId };
  const version = ++navigationVersion;
  setTitle("상세보기");
  renderLoading("상세 정보를 불러오는 중...");
  try {
    const detail = unwrapResult(await desktopApi.detail(itemId));
    if (version === navigationVersion) renderDetail(detail);
  } catch (error) {
    if (version === navigationVersion) renderError(error);
  }
}

function bindDetailButtons() {
  panelContent.querySelectorAll("[data-item-id]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.itemId !== undefined) void openDetail(button.dataset.itemId);
    });
  });
}

async function runAction(action) {
  await runExclusiveAction(async () => {
    const controls = [...panelContent.querySelectorAll("button, input, textarea")];
    const states = controls.map((control) => control.disabled);
    controls.forEach((control) => { control.disabled = true; });
    try { await action(); }
    catch (error) { renderError(error); }
    finally { controls.forEach((control, index) => { if (control.isConnected) control.disabled = states[index]; }); }
  });
}

function renderError(error) {
  panelContent.innerHTML = `<div class="state-message error">${escapeHtml(errorMessage(error, "요청 처리에 실패했습니다."))}</div>`;
}

function errorMessage(error, fallback) {
  return error instanceof Error && error.message !== "" ? error.message : fallback;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character]);
}
