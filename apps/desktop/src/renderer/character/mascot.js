import {
  createExclusiveActionRunner,
  desktopApi,
  formatDateTime,
  formatSyncSummary,
  statusLabel,
  tomorrowAtSameTime,
  unwrapResult,
} from "./desktop-api.mjs";

const character = document.querySelector(".character");
const menuToggle = document.querySelector("[data-menu-toggle]");
const popupMenu = document.querySelector("[data-popup-menu]");
const panel = document.querySelector("[data-panel]");
const panelTitle = document.querySelector("[data-panel-title]");
const panelContent = document.querySelector("[data-panel-content]");
const alphaCanvas = document.createElement("canvas");
const alphaContext = alphaCanvas.getContext("2d", { willReadFrequently: true });
let isIgnoringMouse = true;
let draggingPointerId;
let currentListView = "today";
const runExclusiveTaskAction = createExclusiveActionRunner();

function prepareAlphaMask() {
  if (!(character instanceof HTMLImageElement) || alphaContext === null) return;
  alphaCanvas.width = character.naturalWidth;
  alphaCanvas.height = character.naturalHeight;
  alphaContext.clearRect(0, 0, alphaCanvas.width, alphaCanvas.height);
  alphaContext.drawImage(character, 0, 0);
}

function isOpaquePixel(clientX, clientY) {
  if (!(character instanceof HTMLImageElement) || alphaContext === null || !character.complete) return false;
  const bounds = character.getBoundingClientRect();
  if (bounds.width === 0 || bounds.height === 0) return false;

  const sourceX = Math.min(
    character.naturalWidth - 1,
    Math.max(0, Math.floor((clientX - bounds.left) / bounds.width * character.naturalWidth)),
  );
  const sourceY = Math.min(
    character.naturalHeight - 1,
    Math.max(0, Math.floor((clientY - bounds.top) / bounds.height * character.naturalHeight)),
  );
  try {
    return alphaContext.getImageData(sourceX, sourceY, 1, 1).data[3] > 16;
  } catch {
    // file:// 이미지가 플랫폼 정책상 canvas를 오염시키는 경우에도 마스코트가 영원히
    // click-through 상태로 잠기지 않게 idle 캐릭터의 보수적인 경계로 폴백한다.
    const normalizedX = (clientX - bounds.left) / bounds.width;
    const normalizedY = (clientY - bounds.top) / bounds.height;
    return normalizedX >= 0.24 && normalizedX <= 0.76 && normalizedY >= 0.05 && normalizedY <= 0.9;
  }
}

function updateMousePassthrough(event) {
  if (draggingPointerId !== undefined) return;
  const interactive = event.target instanceof Element
    && event.target.closest("[data-popup-menu], [data-panel], [data-menu-toggle]") !== null;
  const shouldIgnore = !interactive && !isOpaquePixel(event.clientX, event.clientY);
  if (shouldIgnore === isIgnoringMouse) return;
  isIgnoringMouse = shouldIgnore;
  window.desktopMascot?.setMousePassthrough(shouldIgnore);
}

function startCharacterDrag(event) {
  const clickedMenu = event.target instanceof Element
    && event.target.closest("[data-menu-toggle]") !== null;
  if (event.button !== 0 || clickedMenu) return;
  const dragTarget = event.currentTarget;
  if (!(dragTarget instanceof HTMLElement)) return;

  draggingPointerId = event.pointerId;
  isIgnoringMouse = false;
  window.desktopMascot?.setMousePassthrough(false);
  window.desktopMascot?.startDrag(event.screenX, event.screenY);
  dragTarget.setPointerCapture(event.pointerId);
  dragTarget.classList.add("is-dragging");
  event.preventDefault();
}

function moveCharacterDrag(event) {
  if (event.pointerId !== draggingPointerId) return;
  window.desktopMascot?.moveDrag(event.screenX, event.screenY);
}

function endCharacterDrag(event) {
  if (event.pointerId !== draggingPointerId) return;
  draggingPointerId = undefined;
  window.desktopMascot?.endDrag();
  if (event.currentTarget instanceof HTMLElement) {
    event.currentTarget.classList.remove("is-dragging");
  }
}

if (character instanceof HTMLImageElement) {
  if (character.complete) prepareAlphaMask();
  else character.addEventListener("load", prepareAlphaMask, { once: true });
  // Main과 Renderer가 각각 초기 mouse-ignore 상태를 쓰면 loadFile 완료 시점에 따라
  // 실제 창 상태와 isIgnoringMouse가 어긋날 수 있다. Renderer를 단일 소유자로 두고
  // 투명 여백을 먼저 click-through로 만든 뒤, 전달받은 mousemove로 캐릭터 위에서
  // false로 전환한다. 그래야 -webkit-app-region: drag가 실제 마우스 입력을 받는다.
  window.desktopMascot?.setMousePassthrough(isIgnoringMouse);
  window.addEventListener("mousemove", updateMousePassthrough);
}

const characterButton = document.querySelector("[data-character]");
characterButton?.addEventListener("pointerdown", startCharacterDrag);
characterButton?.addEventListener("pointermove", moveCharacterDrag);
characterButton?.addEventListener("pointerup", endCharacterDrag);
characterButton?.addEventListener("pointercancel", endCharacterDrag);

menuToggle?.addEventListener("click", () => {
  const willOpen = popupMenu.hidden;
  popupMenu.hidden = !willOpen;
  panel.hidden = true;
});

document.querySelector("[data-close-panel]")?.addEventListener("click", closePanel);

popupMenu?.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!(button instanceof HTMLButtonElement)) return;
  const view = button.dataset.view;
  if (view !== undefined) await openView(view);
  if (button.dataset.action === "sync") await runSync(button);
});

async function openView(view, { throwOnError = false } = {}) {
  popupMenu.hidden = true;
  panel.hidden = false;
  panelTitle.textContent = viewTitle(view);
  panelContent.innerHTML = '<div class="state-message">불러오는 중...</div>';
  try {
    if (view === "today") {
      currentListView = view;
      renderRankedItems(unwrapResult(await desktopApi.today()).items, "오늘 확인할 일이 없습니다.");
    } else if (view === "calendar") {
      currentListView = view;
      renderScheduledItems(unwrapResult(await desktopApi.calendar()).items);
    } else if (view === "inbox") {
      currentListView = view;
      renderRecommendations(unwrapResult(await desktopApi.inbox()).items);
    }
    else if (view === "ask") renderAsk();
    else if (view === "add") renderAdd();
    else renderSettings();
  } catch (error) {
    if (throwOnError) throw error;
    renderError(error);
  }
}

function renderRankedItems(entries, emptyMessage) {
  if (entries.length === 0) {
    panelContent.innerHTML = `<div class="state-message">${escapeHtml(emptyMessage)}</div>`;
    return;
  }
  panelContent.innerHTML = `<div class="card-list">${entries.map(({ item, score, reason }) => `
    <button class="context-card" type="button" data-item-id="${escapeHtml(item.id)}">
      <span class="card-kind">${item.kind === "event" ? "일정" : "할 일"}</span>
      <strong>${escapeHtml(item.title)}</strong>
      <span>${escapeHtml(formatDateTime(item.startAt ?? item.deadline))}</span>
      <small>${escapeHtml(`${score}점 · ${reason} · ${statusLabel(item.status)}`)}</small>
    </button>`).join("")}</div>`;
  panelContent.querySelectorAll("[data-item-id]").forEach((button) => {
    button.addEventListener("click", () => openDetail(button.dataset.itemId));
  });
}

function renderScheduledItems(entries) {
  if (entries.length === 0) {
    panelContent.innerHTML = '<div class="state-message">이번 주 일정이 없습니다.</div>';
    return;
  }
  panelContent.innerHTML = `<div class="card-list">${entries.map(({ item, at }) => `
    <button class="context-card" type="button" data-item-id="${escapeHtml(item.id)}">
      <span class="card-kind">${item.kind === "event" ? "일정" : "마감"}</span>
      <strong>${escapeHtml(item.title)}</strong>
      <span>${escapeHtml(formatDateTime(at))}</span>
      <small>${escapeHtml(statusLabel(item.status))}</small>
    </button>`).join("")}</div>`;
  panelContent.querySelectorAll("[data-item-id]").forEach((button) => {
    button.addEventListener("click", () => openDetail(button.dataset.itemId));
  });
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
      <textarea id="question" name="question" rows="3" placeholder="예: 이번 주 마감이 뭐야?" required></textarea>
      <button class="primary-button" type="submit">물어보기</button>
    </form>
    <div class="answer" data-answer hidden></div>`;
  panelContent.querySelector("[data-ask-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const answer = panelContent.querySelector("[data-answer]");
    const question = new FormData(event.currentTarget).get("question")?.toString().trim() ?? "";
    if (!(answer instanceof HTMLElement) || question === "") return;
    answer.hidden = false;
    answer.textContent = "답변을 찾는 중...";
    try {
      const result = unwrapResult(await desktopApi.ask(question));
      answer.textContent = `${result.answer}\n근거 ${result.evidence.length}개`;
    } catch (error) {
      answer.textContent = error instanceof Error ? error.message : "질문 처리에 실패했습니다.";
    }
  });
}

function renderAdd() {
  panelContent.innerHTML = `
    <form class="add-form" data-add-form>
      <div class="form-field">
        <label for="add-title">일정 내용</label>
        <input id="add-title" name="title" type="text" placeholder="예: 도현님들과 저녁 약속" required />
      </div>
      <div class="form-row">
        <div class="form-field">
          <label for="add-date">날짜</label>
          <input id="add-date" name="date" type="date" required />
        </div>
        <div class="form-field">
          <label for="add-time">시작</label>
          <input id="add-time" name="time" type="time" required />
        </div>
      </div>
      <div class="form-row">
        <div class="form-field">
          <label for="add-end-time">종료(선택)</label>
          <input id="add-end-time" name="endTime" type="time" />
        </div>
        <div class="form-field">
          <label for="add-location">장소(선택)</label>
          <input id="add-location" name="location" type="text" placeholder="예: 궁칼국수" />
        </div>
      </div>
      <button class="primary-button" type="submit">일정 추가</button>
    </form>`;

  panelContent.querySelector("[data-add-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector("button[type='submit']");
    const data = new FormData(form);
    const optional = (name) => data.get(name)?.toString().trim() || undefined;
    const input = {
      title: data.get("title")?.toString().trim() ?? "",
      date: data.get("date")?.toString() ?? "",
      time: data.get("time")?.toString() ?? "",
      endTime: optional("endTime"),
      location: optional("location"),
    };

    if (submit instanceof HTMLButtonElement) submit.disabled = true;
    try {
      unwrapResult(await desktopApi.add(input));
      panelContent.innerHTML = '<div class="state-message success">일정을 추가했습니다.</div>';
    } catch (error) {
      renderError(error);
    } finally {
      if (submit instanceof HTMLButtonElement && submit.isConnected) submit.disabled = false;
    }
  });
}

async function openDetail(id) {
  if (id === undefined) return;
  panelTitle.textContent = "상세보기";
  panelContent.innerHTML = '<div class="state-message">상세 정보를 불러오는 중...</div>';
  try {
    renderDetail(unwrapResult(await desktopApi.detail(id)));
  } catch (error) {
    renderError(error);
  }
}

function renderDetail({ item, evidence, isSnoozed, snoozedUntil }) {
  const requirementsContent = item.requirements.length === 0
    ? '<p class="evidence-note">등록된 요구사항이 없습니다.</p>'
    : `<ul class="evidence-list">${item.requirements.map((requirement) => `
        <li>${escapeHtml(requirement)}</li>`).join("")}</ul>`;
  const evidenceContent = evidence.length === 0
    ? '<p class="evidence-note">연결된 근거가 없습니다.</p>'
    : `<ul class="evidence-list">${evidence.map((entry) => `
        <li>
          ${escapeHtml(entry.quote)}
          <small>${escapeHtml(`${entry.sourceType} · ${entry.location}`)}</small>
        </li>`).join("")}</ul>`;
  const actionContent = item.kind === "task" && item.status !== "done"
    ? `<div class="action-row">
        <button class="primary-button" type="button" data-complete>완료</button>
        <button class="secondary-button" type="button" data-snooze>내일 알림</button>
      </div>`
    : "";
  panelContent.innerHTML = `
    <article class="detail-card">
      <span class="card-kind">${item.kind === "event" ? "일정" : "할 일"}</span>
      <h2>${escapeHtml(item.title)}</h2>
      <dl>
        <div><dt>시간</dt><dd>${escapeHtml(formatDateTime(item.startAt ?? item.deadline))}</dd></div>
        <div><dt>상태</dt><dd>${escapeHtml(statusLabel(item.status))}</dd></div>
        ${isSnoozed ? `<div><dt>미룸</dt><dd>${escapeHtml(formatDateTime(snoozedUntil))}까지</dd></div>` : ""}
      </dl>
      <h2>요구사항</h2>
      ${requirementsContent}
      <h2>근거</h2>
      ${evidenceContent}
      ${actionContent}
    </article>`;
  panelContent.querySelector("[data-complete]")?.addEventListener("click", (event) => runTaskAction(
    event.currentTarget,
    () => desktopApi.complete(item.id),
  ));
  panelContent.querySelector("[data-snooze]")?.addEventListener("click", (event) => runTaskAction(
    event.currentTarget,
    () => desktopApi.snooze(item.id, tomorrowAtSameTime()),
  ));
}

async function runTaskAction(button, action) {
  if (!(button instanceof HTMLButtonElement)) return;
  await runExclusiveTaskAction(async () => {
    const actionButtons = button.closest(".action-row")?.querySelectorAll("button") ?? [button];
    for (const actionButton of actionButtons) actionButton.disabled = true;
    try {
      try {
        unwrapResult(await action());
      } catch (error) {
        renderError(error);
        return;
      }
      try {
        await openView(currentListView, { throwOnError: true });
      } catch (error) {
        const detail = error instanceof Error ? error.message : "알 수 없는 오류";
        renderError(new Error(`처리는 완료됐지만 목록 갱신에 실패했습니다. ${detail}`));
      }
    } finally {
      for (const actionButton of actionButtons) {
        if (actionButton.isConnected) actionButton.disabled = false;
      }
    }
  });
}

function renderSettings() {
  panelContent.innerHTML = `
    <div class="settings-list">
      <button type="button">프로필 <span>›</span></button>
      <button type="button">일정 관리 <span>›</span></button>
      <button type="button">Source 관리 <span>›</span></button>
    </div>
    <p class="hint">설정 IPC가 준비되면 각 화면을 연결합니다.</p>`;
}

async function runSync(button) {
  button.disabled = true;
  const original = button.innerHTML;
  button.textContent = "동기화 중...";
  try {
    const result = unwrapResult(await desktopApi.sync());
    popupMenu.hidden = true;
    panel.hidden = false;
    panelTitle.textContent = "동기화";
    panelContent.innerHTML = `<div class="state-message success">${escapeHtml(formatSyncSummary(result))}</div>`;
  } catch (error) {
    renderError(error);
  } finally {
    button.disabled = false;
    button.innerHTML = original;
  }
}

function renderError(error) {
  const message = error instanceof Error ? error.message : "데이터를 불러오지 못했습니다.";
  panelContent.innerHTML = `<div class="state-message error">${escapeHtml(message)}</div>`;
}

function closePanel() {
  panel.hidden = true;
}

function viewTitle(view) {
  return ({ today: "오늘 할 일", calendar: "이번 주", inbox: "추천", ask: "물어보기", add: "일정 추가", settings: "설정" })[view] ?? "DoDoDo";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
