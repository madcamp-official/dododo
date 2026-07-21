import {
  desktopApi,
  formatDateTime,
  formatSyncSummary,
  statusLabel,
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
  const interactive = event.target instanceof Element
    && event.target.closest("[data-popup-menu], [data-panel], [data-menu-toggle]") !== null;
  const shouldIgnore = !interactive && !isOpaquePixel(event.clientX, event.clientY);
  if (shouldIgnore === isIgnoringMouse) return;
  isIgnoringMouse = shouldIgnore;
  window.desktopMascot?.setMousePassthrough(shouldIgnore);
}

if (character instanceof HTMLImageElement) {
  if (character.complete) prepareAlphaMask();
  else character.addEventListener("load", prepareAlphaMask, { once: true });
  window.addEventListener("mousemove", updateMousePassthrough);
}

menuToggle?.addEventListener("click", () => {
  popupMenu.hidden = !popupMenu.hidden;
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

async function openView(view) {
  popupMenu.hidden = true;
  panel.hidden = false;
  panelTitle.textContent = viewTitle(view);
  panelContent.innerHTML = '<div class="state-message">불러오는 중...</div>';
  try {
    if (view === "today") {
      renderRankedItems(unwrapResult(await desktopApi.today()).items, "오늘 확인할 일이 없습니다.");
    } else if (view === "calendar") {
      renderScheduledItems(unwrapResult(await desktopApi.calendar()).items);
    } else if (view === "inbox") {
      renderRecommendations(unwrapResult(await desktopApi.inbox()).items);
    }
    else if (view === "ask") renderAsk();
    else renderSettings();
  } catch (error) {
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
    button.addEventListener("click", () => {
      renderDetail(entries.find((entry) => entry.item.id === button.dataset.itemId)?.item);
    });
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
    button.addEventListener("click", () => {
      renderDetail(entries.find((entry) => entry.item.id === button.dataset.itemId)?.item);
    });
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

function renderDetail(item) {
  if (item === undefined) return;
  panelTitle.textContent = "상세보기";
  panelContent.innerHTML = `
    <article class="detail-card">
      <span class="card-kind">${item.kind === "event" ? "일정" : "할 일"}</span>
      <h2>${escapeHtml(item.title)}</h2>
      <dl>
        <div><dt>시간</dt><dd>${escapeHtml(formatDateTime(item.startAt ?? item.deadline))}</dd></div>
        <div><dt>상태</dt><dd>${escapeHtml(statusLabel(item.status))}</dd></div>
      </dl>
      <p class="evidence-note">근거는 실제 IPC 연결 후 함께 표시됩니다.</p>
      <div class="action-row">
        <button class="primary-button" type="button" data-complete>완료</button>
        <button class="secondary-button" type="button" data-snooze>내일 알림</button>
      </div>
    </article>`;
  panelContent.querySelector("[data-complete]")?.addEventListener("click", () => showPendingAction("완료 처리"));
  panelContent.querySelector("[data-snooze]")?.addEventListener("click", () => showPendingAction("Snooze"));
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

function showPendingAction(name) {
  panelContent.insertAdjacentHTML("beforeend", `<p class="hint">${escapeHtml(name)}는 Main IPC 연결 후 활성화됩니다.</p>`);
}

function renderError(error) {
  const message = error instanceof Error ? error.message : "데이터를 불러오지 못했습니다.";
  panelContent.innerHTML = `<div class="state-message error">${escapeHtml(message)}</div>`;
}

function closePanel() {
  panel.hidden = true;
}

function viewTitle(view) {
  return ({ today: "오늘 할 일", calendar: "이번 주", inbox: "추천", ask: "물어보기", settings: "설정" })[view] ?? "DoDoDo";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
