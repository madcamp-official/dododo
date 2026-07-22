import {
  createExclusiveActionRunner,
  desktopApi,
  formatDateTime,
  formatSyncSummary,
  statusLabel,
  tomorrowAtSameTime,
  unwrapResult,
} from "./desktop-api.mjs";
import {
  createNotificationStore,
  notificationKindLabel,
  notificationMode,
} from "./notification-state.mjs";
import { parseReminderOffset, scheduleItemToForm } from "./schedule-form.mjs";
import { buildDailySummary, dailySummaryRetryDelayMs, shouldShowDailySummary } from "./daily-summary.mjs";
import { buildWeeklyCalendar } from "./schedule-management.mjs";
import { studyProgressView, studySummaryView } from "./study-session-ui.mjs";
import { notificationEffect, notificationExpression, restingExpression } from "./character-expression.mjs";

const character = document.querySelector(".character");
const characterEffect = document.querySelector("[data-character-effect]");
const menuToggle = document.querySelector("[data-menu-toggle]");
const popupMenu = document.querySelector("[data-popup-menu]");
const panel = document.querySelector("[data-panel]");
const panelTitle = document.querySelector("[data-panel-title]");
const panelContent = document.querySelector("[data-panel-content]");
const notificationBubble = document.querySelector("[data-notification-bubble]");
const notificationKind = document.querySelector("[data-notification-kind]");
const notificationMessage = document.querySelector("[data-notification-message]");
const notificationDetail = document.querySelector("[data-notification-detail]");
const notificationBadge = document.querySelector("[data-notification-badge]");
const alphaCanvas = document.createElement("canvas");
const alphaContext = alphaCanvas.getContext("2d", { willReadFrequently: true });
let isIgnoringMouse = true;
let draggingPointerId;
let currentListView = "today";
const runExclusiveTaskAction = createExclusiveActionRunner();
const notificationStore = createNotificationStore();
const STANDALONE_PANEL_VIEWS = new Set(["today", "calendar", "inbox", "ask"]);
const NOTIFICATION_DISPLAY_MS = 6_000;
const STUDY_IDLE_PATROL_MESSAGE = "지금 오랫동안 같은 화면인데 자고 계시는 거 아니죠?";
let activeNotification;
let notificationTimer;
const unsubscribePlacement = window.desktopMascot?.onPlacement?.((placement) => {
  if (["top-left", "top-right", "bottom-left", "bottom-right"].includes(placement)) {
    document.body.dataset.characterPlacement = placement;
  }
});
let activeStudySession;
let studyProgressTimer;
let notificationSubscriptionRetry;
let unsubscribeNotifications;
let dailySummaryRetryTimer;
let effectTimer;
let patrolFrameTimer;
let patrolRunId = 0;
let isPatrolling = false;

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
  const hasOpenInteractiveSurface = popupMenu?.hidden === false || panel?.hidden === false;
  const interactive = event.target instanceof Element
    && event.target.closest("[data-popup-menu], [data-panel], [data-menu-toggle], [data-notification-bubble], [data-notification-badge]") !== null;
  // Once a menu or embedded panel is open, keep the window interactive. If we
  // re-enable passthrough while the pointer crosses the transparent gap, UI
  // automation and keyboard users cannot recover focus without moving a
  // physical mouse over a rendered control first.
  const shouldIgnore = !hasOpenInteractiveSurface && !interactive && !isOpaquePixel(event.clientX, event.clientY);
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

  cancelPatrol();

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
  // 투명 여백을 먼저 click-through로 만든 뒤, mousemove로 캐릭터(불투명 픽셀)나
  // 메뉴·패널 위에서 false로 전환한다. 그래야 pointerdown이 characterButton까지
  // 도달해 startCharacterDrag가 실행된다(더 이상 CSS -webkit-app-region: drag가
  // 아니라 Pointer Event 기반 드래그다 — Main.setPosition으로 창을 옮긴다).
  window.desktopMascot?.setMousePassthrough(isIgnoringMouse);
  window.addEventListener("mousemove", updateMousePassthrough);
}

const characterButton = document.querySelector("[data-character]");
characterButton?.addEventListener("pointerdown", startCharacterDrag);
characterButton?.addEventListener("pointermove", moveCharacterDrag);
characterButton?.addEventListener("pointerup", endCharacterDrag);
characterButton?.addEventListener("pointercancel", endCharacterDrag);

menuToggle?.addEventListener("click", () => {
  cancelPatrol();
  const willOpen = popupMenu.hidden;
  popupMenu.hidden = !willOpen;
  panel.hidden = true;
});

notificationBadge?.addEventListener("click", renderNotificationCenter);
document.querySelector("[data-dismiss-notification]")?.addEventListener("click", dismissActiveNotification);
notificationDetail?.addEventListener("click", () => {
  const contextItemId = activeNotification?.contextItemId;
  const targetView = activeNotification?.targetView;
  dismissActiveNotification();
  if (targetView !== undefined) openStandalonePanel({ view: targetView });
  else if (contextItemId !== undefined) openStandalonePanel({ view: "detail", itemId: contextItemId });
});

subscribeToNotifications();
void showDailySummaryOnFirstLaunch();
const studySessionRestorePromise = restoreStudySession();
window.addEventListener("beforeunload", () => {
  if (notificationTimer !== undefined) window.clearTimeout(notificationTimer);
  if (notificationSubscriptionRetry !== undefined) window.clearTimeout(notificationSubscriptionRetry);
  if (dailySummaryRetryTimer !== undefined) window.clearTimeout(dailySummaryRetryTimer);
  if (effectTimer !== undefined) window.clearTimeout(effectTimer);
  cancelPatrol();
  stopStudyProgressTimer();
  unsubscribeNotifications?.();
  unsubscribePlacement?.();
}, { once: true });

document.querySelector("[data-close-panel]")?.addEventListener("click", closePanel);

popupMenu?.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!(button instanceof HTMLButtonElement)) return;
  cancelPatrol();
  const view = button.dataset.view;
  if (view === "settings") openSettingsWindow();
  else if (view !== undefined && STANDALONE_PANEL_VIEWS.has(view)) {
    popupMenu.hidden = true;
    openStandalonePanel({ view });
  } else if (view !== undefined) await openView(view);
  if (button.dataset.action === "sync") await runSync(button);
  if (button.dataset.action === "study") await openStudySession();
});

function openSettingsWindow() {
  popupMenu.hidden = true;
  const openSettings = window.desktopWindow?.openSettings;
  if (typeof openSettings === "function") {
    openSettings();
    return;
  }
  panel.hidden = false;
  panelTitle.textContent = "설정";
  renderError(new Error("설정 창을 열 수 없습니다. 앱을 다시 실행해주세요."));
}

function openStandalonePanel(route) {
  window.desktopWindow?.openPanel(route);
}

async function openStudySession() {
  await studySessionRestorePromise;
  popupMenu.hidden = true;
  panel.hidden = false;
  panelTitle.textContent = "같이 공부하기";
  if (activeStudySession === undefined) {
    panelContent.innerHTML = `
      <p>세션 중 현재 화면을 분석해 관련 과제와 구체적인 조언을 찾습니다.</p>
      <label class="consent-row"><input type="checkbox" data-study-consent> 화면 캡처와 LLM 분석에 동의합니다.</label>
      <p class="hint">원격 LLM을 사용 중이면 스크린샷이 팀 서버로 전송될 수 있으며 원본은 분석 직후 폐기됩니다.</p>
      <button class="primary-button" type="button" data-study-start>시작</button>`;
    panelContent.querySelector("[data-study-start]")?.addEventListener("click", startStudySession);
  } else {
    panelContent.innerHTML = `
      <section class="study-progress">
        <span class="study-status-dot" aria-hidden="true"></span>
        <div><strong data-study-elapsed>00:00</strong><p data-study-status aria-live="polite"></p></div>
      </section>
      <p class="hint">세션이 진행되는 동안에만 화면 분석 기능을 사용할 수 있습니다.</p>
      <button class="danger-button" type="button" data-study-end>세션 종료</button>`;
    panelContent.querySelector("[data-study-end]")?.addEventListener("click", endStudySession);
    renderStudyProgress();
    startStudyProgressTimer();
  }
}

async function restoreStudySession() {
  try {
    const active = unwrapResult(await desktopApi.studyGet());
    activeStudySession = active === undefined ? undefined : { ...active, restored: true };
    updateStudyCharacter();
  } catch {
    // 세션 복원 실패는 다른 메뉴와 알림 사용을 막지 않는다.
  }
}

async function startStudySession() {
  await runExclusivePanelAction(async () => {
    const consent = panelContent.querySelector("[data-study-consent]")?.checked === true;
    try {
      const result = unwrapResult(await desktopApi.studyStart(consent));
      activeStudySession = { ...result, restored: false };
      updateStudyCharacter();
      await openStudySession();
    } catch (error) { renderError(error); }
  });
}

async function endStudySession() {
  await runExclusivePanelAction(async () => {
    try {
      const result = unwrapResult(await desktopApi.studyEnd(activeStudySession.sessionId));
      activeStudySession = undefined;
      stopStudyProgressTimer();
      updateStudyCharacter();
      const summary = studySummaryView(result);
      panelContent.innerHTML = `
        <section class="study-summary">
          <span aria-hidden="true">✓</span>
          <div><h2>${escapeHtml(summary.title)}</h2>
          <p>${escapeHtml(summary.durationLabel)} · ${escapeHtml(summary.adviceLabel)}</p></div>
        </section>
        <button class="primary-button" type="button" data-study-restart>다시 시작</button>`;
      panelContent.querySelector("[data-study-restart]")?.addEventListener("click", openStudySession);
    } catch (error) { renderError(error); }
  });
}

function renderStudyProgress(now = new Date()) {
  if (activeStudySession === undefined) return;
  const view = studyProgressView(activeStudySession, now);
  const elapsed = panelContent.querySelector("[data-study-elapsed]");
  const status = panelContent.querySelector("[data-study-status]");
  if (elapsed !== null) elapsed.textContent = view.elapsedLabel;
  if (status !== null && status.textContent !== view.statusText) status.textContent = view.statusText;
}

function startStudyProgressTimer() {
  stopStudyProgressTimer();
  studyProgressTimer = window.setInterval(() => renderStudyProgress(), 1_000);
}

function stopStudyProgressTimer() {
  if (studyProgressTimer !== undefined) window.clearInterval(studyProgressTimer);
  studyProgressTimer = undefined;
}

function updateStudyCharacter() {
  document.body.classList.toggle("is-studying", activeStudySession !== undefined);
  if (activeNotification !== undefined) return;
  setCharacterExpression(restingExpression(activeStudySession !== undefined));
}

function setCharacterExpression(expression) {
  if (!(character instanceof HTMLImageElement)) return;
  if (!character.src.endsWith(`/${expression.asset}`)) {
    character.addEventListener("load", prepareAlphaMask, { once: true });
    character.src = `../../../resources/character/${expression.asset}`;
  }
  character.alt = expression.alt;
}

function showCharacterEffect(asset, durationMs = 900) {
  if (!(characterEffect instanceof HTMLImageElement) || asset === undefined) return;
  if (effectTimer !== undefined) window.clearTimeout(effectTimer);
  characterEffect.src = `../../../resources/effects/${asset}`;
  characterEffect.dataset.effect = asset;
  characterEffect.hidden = false;
  characterEffect.style.animation = "none";
  void characterEffect.offsetWidth;
  characterEffect.style.animation = "";
  effectTimer = window.setTimeout(() => {
    characterEffect.hidden = true;
    delete characterEffect.dataset.effect;
    effectTimer = undefined;
  }, durationMs);
}

function beginThinking() {
  cancelPatrol();
  if (activeNotification !== undefined) return;
  setCharacterExpression({ asset: "thinking.png", alt: "생각 중인 DoDoDo 도토리 캐릭터" });
  showCharacterEffect("question.png", 1_200);
}

function endThinking(effect) {
  if (effect !== undefined) showCharacterEffect(effect);
  updateStudyCharacter();
}

function canPatrol() {
  return activeStudySession !== undefined && draggingPointerId === undefined;
}

function wait(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function startWalkFrames(sideways) {
  let frame = 0;
  const assets = sideways ? ["walk-side-01.png", "walk-side-02.png"] : ["walk-01.png", "walk-02.png"];
  setCharacterExpression({ asset: assets[0], alt: "화면을 산책하는 DoDoDo 도토리 캐릭터" });
  patrolFrameTimer = window.setInterval(() => {
    frame = (frame + 1) % assets.length;
    setCharacterExpression({ asset: assets[frame], alt: "화면을 산책하는 DoDoDo 도토리 캐릭터" });
  }, 180);
}

function stopWalkFrames() {
  if (patrolFrameTimer !== undefined) window.clearInterval(patrolFrameTimer);
  patrolFrameTimer = undefined;
}

async function walkLeg(runId, direction) {
  if (!(characterButton instanceof HTMLElement) || runId !== patrolRunId) return false;
  const bridge = window.desktopMascot;
  if (typeof bridge?.startDrag !== "function"
    || typeof bridge?.moveDrag !== "function"
    || typeof bridge?.endDrag !== "function") return false;
  characterButton.dataset.walkDirection = direction;
  characterButton.classList.add("is-walking");
  startWalkFrames(true);
  showCharacterEffect("dust.png");
  await wait(180);
  if (runId !== patrolRunId) return false;
  showCharacterEffect("speed-lines.png");

  const rect = characterButton.getBoundingClientRect();
  const startX = window.screenX + rect.left + rect.width / 2;
  const pointerY = window.screenY + rect.top + rect.height / 2;
  const availableLeft = window.screen.availLeft ?? 0;
  const targetLeft = direction === "left"
    ? availableLeft + 4
    : availableLeft + window.screen.availWidth - rect.width - 4;
  const targetX = targetLeft + rect.width / 2;
  const startedAt = performance.now();
  const durationMs = 4_500;

  bridge.startDrag(startX, pointerY);
  while (runId === patrolRunId) {
    const progress = Math.min(1, (performance.now() - startedAt) / durationMs);
    const eased = progress < 0.5
      ? 2 * progress * progress
      : 1 - Math.pow(-2 * progress + 2, 2) / 2;
    bridge.moveDrag(startX + (targetX - startX) * eased, pointerY);
    if (progress >= 1) break;
    await wait(16);
  }
  bridge.endDrag();
  stopWalkFrames();
  return runId === patrolRunId;
}

async function runPatrol() {
  if (!canPatrol() || !(characterButton instanceof HTMLElement)) {
    return;
  }
  isPatrolling = true;
  const runId = ++patrolRunId;
  const startsRight = (document.body.dataset.characterPlacement ?? "bottom-right").endsWith("right");
  const outward = startsRight ? "left" : "right";
  const homeward = startsRight ? "right" : "left";

  if (!await walkLeg(runId, outward)) return;
  showCharacterEffect("sparkle.png");
  startWalkFrames(false);
  await wait(900);
  stopWalkFrames();
  if (runId !== patrolRunId || !await walkLeg(runId, homeward)) return;
  showCharacterEffect("heart.png", 1_000);
  await wait(700);
  if (runId === patrolRunId) finishPatrol();
}

function finishPatrol() {
  stopWalkFrames();
  isPatrolling = false;
  if (characterButton instanceof HTMLElement) {
    characterButton.classList.remove("is-walking");
    delete characterButton.dataset.walkDirection;
    characterButton.style.transform = "";
  }
  updateStudyCharacter();
}

function cancelPatrol() {
  if (!isPatrolling) return;
  patrolRunId += 1;
  finishPatrol();
}

async function openView(view, { throwOnError = false } = {}) {
  stopStudyProgressTimer();
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
    else throw new Error("지원하지 않는 화면입니다.");
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
      <small>${escapeHtml([`${score}점`, reason, statusLabel(item.status)].filter(Boolean).join(" · "))}</small>
    </button>`).join("")}</div>`;
  panelContent.querySelectorAll("[data-item-id]").forEach((button) => {
    button.addEventListener("click", () => openDetail(button.dataset.itemId));
  });
}

function renderScheduledItems(entries) {
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
      ${reason ? `<span>${escapeHtml(reason)}</span>` : ""}
      <small>${escapeHtml(`${score}점 · ${formatDateTime(item.deadline)}`)}</small>
    </article>`).join("")}</div>`;
}

function renderAsk() {
  panelContent.innerHTML = `
    <form class="ask-form" data-ask-form>
      <label for="question">무엇이 궁금한가요?</label>
      <textarea id="question" name="question" rows="3" placeholder="예: 이번 주 마감이 뭐야?" required></textarea>
      <button class="primary-button" type="submit">물어보기</button>
    </form>`;
  panelContent.querySelector("[data-ask-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = event.currentTarget.querySelector("button[type='submit']");
    const question = new FormData(event.currentTarget).get("question")?.toString().trim() ?? "";
    if (question === "") return;
    const originalLabel = submit?.textContent ?? "물어보기";
    if (submit instanceof HTMLButtonElement) {
      submit.disabled = true;
      submit.textContent = "답변을 기다리는 중...";
    }
    beginThinking();
    try {
      unwrapResult(await desktopApi.ask(question));
    } catch (error) {
      renderError(error instanceof Error ? error : new Error("질문 처리에 실패했습니다."));
    } finally {
      endThinking("sparkle.png");
      if (submit instanceof HTMLButtonElement && submit.isConnected) {
        submit.disabled = false;
        submit.textContent = originalLabel;
      }
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

function handleNotification(payload) {
  cancelPatrol();
  const result = notificationStore.push(payload);
  if (!result.accepted) return;
  if (result.mode === "quiet") {
    updateNotificationBadge();
  }
  // 답변 말풍선이 떠 있는 동안 다음 질문의 답변이 오면 사용자가 직접 닫거나
  // 15초 타이머를 기다리지 않고 최신 답변으로 즉시 교체한다.
  if (result.event.kind === "answer" && activeNotification?.kind === "answer") {
    dismissActiveNotification();
    return;
  }
  showNextNotification();
}

async function showDailySummaryOnFirstLaunch() {
  const stateKey = "lastDailySummaryDate";
  try {
    const [lastShownDate, profile] = await Promise.all([
      desktopApi.uiStateGet(stateKey).then(unwrapResult),
      desktopApi.profileGet().then(unwrapResult),
    ]);
    const now = new Date();
    const decision = shouldShowDailySummary(lastShownDate, profile, now);
    if (!decision.show) {
      const retryDelay = dailySummaryRetryDelayMs(profile, now);
      if (retryDelay !== undefined && dailySummaryRetryTimer === undefined) {
        dailySummaryRetryTimer = window.setTimeout(() => {
          dailySummaryRetryTimer = undefined;
          void showDailySummaryOnFirstLaunch();
        }, retryDelay);
      }
      return;
    }
    const { items } = unwrapResult(await desktopApi.today());
    handleNotification({
      kind: "daily-summary",
      message: buildDailySummary(items),
      targetView: "today",
      createdAt: now.toISOString(),
    });
    unwrapResult(await desktopApi.uiStateSet(stateKey, decision.today));
  } catch (error) {
    console.warn("일일 요약을 표시하지 못했습니다.", error);
  }
}

function subscribeToNotifications() {
  const onNotification = window.desktopEvents?.onNotification;
  if (typeof onNotification === "function") {
    unsubscribeNotifications = onNotification(handleNotification);
    return;
  }

  notificationSubscriptionRetry = window.setTimeout(() => {
    notificationSubscriptionRetry = undefined;
    const retryOnNotification = window.desktopEvents?.onNotification;
    if (typeof retryOnNotification === "function") {
      unsubscribeNotifications = retryOnNotification(handleNotification);
      return;
    }
    console.warn("DoDoDo 알림 이벤트 브리지를 찾지 못해 알림 구독을 시작하지 못했습니다.");
  }, 0);
}

function showNextNotification() {
  if (activeNotification !== undefined) return;
  const next = notificationStore.takeImmediate();
  if (next === undefined) return;
  if (!(notificationBubble instanceof HTMLElement)
    || !(notificationKind instanceof HTMLElement)
    || !(notificationMessage instanceof HTMLElement)
    || !(notificationDetail instanceof HTMLButtonElement)) return;

  activeNotification = next;
  setCharacterExpression(notificationExpression(next.kind));
  showCharacterEffect(notificationEffect(next.kind));
  notificationBubble.setAttribute("aria-live", notificationMode(next.kind) === "quiet" ? "polite" : "assertive");
  notificationKind.textContent = notificationKindLabel(next.kind);
  notificationMessage.textContent = next.message;
  if (next.kind === "distraction" && next.message === STUDY_IDLE_PATROL_MESSAGE) {
    void runPatrol();
  }
  notificationDetail.hidden = next.contextItemId === undefined && next.targetView === undefined;
  notificationDetail.textContent = next.targetView === "today" ? "오늘 보기" : "자세히 보기";
  notificationBubble.hidden = false;
  notificationTimer = window.setTimeout(
    dismissActiveNotification,
    next.kind === "answer" || next.message === STUDY_IDLE_PATROL_MESSAGE ? 15_000 : NOTIFICATION_DISPLAY_MS,
  );
}

function dismissActiveNotification() {
  if (notificationTimer !== undefined) {
    window.clearTimeout(notificationTimer);
    notificationTimer = undefined;
  }
  activeNotification = undefined;
  if (notificationBubble instanceof HTMLElement) notificationBubble.hidden = true;
  if (notificationStore.hasImmediate()) showNextNotification();
  else updateStudyCharacter();
}

function updateNotificationBadge() {
  if (!(notificationBadge instanceof HTMLButtonElement)) return;
  const unreadCount = notificationStore.unreadQuietCount();
  notificationBadge.textContent = unreadCount > 99 ? "99+" : String(unreadCount);
  notificationBadge.hidden = unreadCount === 0;
  notificationBadge.setAttribute("aria-label", `새 알림 ${unreadCount}개 보기`);
}

function renderNotificationCenter() {
  const notifications = notificationStore.listQuiet();
  notificationStore.markQuietRead();
  updateNotificationBadge();
  popupMenu.hidden = true;
  panel.hidden = false;
  panelTitle.textContent = "알림";

  if (notifications.length === 0) {
    panelContent.innerHTML = '<div class="state-message">새 알림이 없습니다.</div>';
    return;
  }
  panelContent.innerHTML = `<div class="notification-list">${notifications.map((event, index) => {
    const tag = event.contextItemId === undefined ? "article" : "button";
    const attributes = event.contextItemId === undefined ? "" : `type="button" data-notification-index="${index}"`;
    return `<${tag} ${attributes}>
      <strong>${escapeHtml(notificationKindLabel(event.kind))}</strong>
      <span>${escapeHtml(event.message)}</span>
      <small>${escapeHtml(formatDateTime(event.createdAt))}</small>
    </${tag}>`;
  }).join("")}</div>`;
  panelContent.querySelectorAll("[data-notification-index]").forEach((button) => {
    button.addEventListener("click", () => {
      const event = notifications[Number(button.dataset.notificationIndex)];
      if (event?.contextItemId !== undefined) openDetail(event.contextItemId);
    });
  });
}

function renderDetail(detail) {
  const { item, evidence, isSnoozed, snoozedUntil } = detail;
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
  const form = scheduleItemToForm(item);
  const managementContent = item.kind === "task" || item.kind === "event"
    ? `<div class="management-actions">
        <button class="secondary-button" type="button" data-edit-schedule>수정</button>
        <button class="danger-button" type="button" data-delete-schedule>삭제</button>
      </div>
      <form class="reminder-form" data-reminder-form>
        <label for="reminder-offset">마감 전 알림</label>
        <div>
          <input id="reminder-offset" name="offsetMinutes" type="number" min="1" step="1"
            value="${escapeHtml(form.reminderOffsetMinutes ?? "")}" placeholder="예: 60" required />
          <span>분 전</span>
          <button class="secondary-button" type="submit">저장</button>
        </div>
      </form>`
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
      ${managementContent}
    </article>`;
  panelContent.querySelector("[data-complete]")?.addEventListener("click", (event) => runTaskAction(
    event.currentTarget,
    () => desktopApi.complete(item.id),
  ));
  panelContent.querySelector("[data-snooze]")?.addEventListener("click", (event) => runTaskAction(
    event.currentTarget,
    () => desktopApi.snooze(item.id, tomorrowAtSameTime()),
  ));
  panelContent.querySelector("[data-edit-schedule]")?.addEventListener("click", () => renderScheduleEdit(detail));
  panelContent.querySelector("[data-delete-schedule]")?.addEventListener("click", (event) => {
    runDeleteSchedule(event.currentTarget, item);
  });
  panelContent.querySelector("[data-reminder-form]")?.addEventListener("submit", (event) => {
    runReminderUpdate(event, item.id);
  });
}

function renderScheduleEdit(detail) {
  const { item } = detail;
  const form = scheduleItemToForm(item);
  panelTitle.textContent = item.kind === "task" ? "할 일 수정" : "일정 수정";
  panelContent.innerHTML = `
    <form class="add-form" data-schedule-edit-form>
      <div class="form-field">
        <label for="edit-title">제목</label>
        <input id="edit-title" name="title" type="text" value="${escapeHtml(form.title)}" required />
      </div>
      <div class="form-row">
        <div class="form-field">
          <label for="edit-date">날짜</label>
          <input id="edit-date" name="date" type="date" value="${escapeHtml(form.date)}" required />
        </div>
        <div class="form-field">
          <label for="edit-time">${item.kind === "task" ? "마감" : "시작"}</label>
          <input id="edit-time" name="time" type="time" value="${escapeHtml(form.time)}" required />
        </div>
      </div>
      ${item.kind === "event" ? `<div class="form-field">
        <label for="edit-end-time">종료(선택)</label>
        <input id="edit-end-time" name="endTime" type="time" value="${escapeHtml(form.endTime)}" />
      </div>` : ""}
      <div class="form-field">
        <label for="edit-location">장소(선택)</label>
        <input id="edit-location" name="location" type="text" value="${escapeHtml(form.location)}" />
      </div>
      <div class="action-row">
        <button class="primary-button" type="submit">변경 저장</button>
        <button class="secondary-button" type="button" data-cancel-edit>취소</button>
      </div>
    </form>`;
  panelContent.querySelector("[data-cancel-edit]")?.addEventListener("click", () => renderDetail(detail));
  panelContent.querySelector("[data-schedule-edit-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const target = event.currentTarget;
    if (!(target instanceof HTMLFormElement)) return;
    const data = new FormData(target);
    const optional = (name) => data.get(name)?.toString().trim() || undefined;
    const input = {
      title: data.get("title")?.toString().trim() ?? "",
      date: data.get("date")?.toString() ?? "",
      time: data.get("time")?.toString() ?? "",
      ...(item.kind === "event" ? { endTime: optional("endTime") } : {}),
      location: optional("location"),
    };
    await runExclusivePanelAction(async () => {
      try {
        unwrapResult(await desktopApi.update(item.id, input));
        await openDetail(item.id);
      } catch (error) {
        renderError(error);
      }
    });
  });
}

async function runDeleteSchedule(button, item) {
  if (!(button instanceof HTMLButtonElement)) return;
  if (!window.confirm(`“${item.title}”을(를) 삭제할까요? 목록에서 숨겨지며 근거는 보존됩니다.`)) return;
  await runExclusivePanelAction(async () => {
    try {
      unwrapResult(await desktopApi.delete(item.id));
      await openView(currentListView);
    } catch (error) {
      renderError(error);
    }
  });
}

async function runReminderUpdate(event, id) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!(form instanceof HTMLFormElement)) return;
  const offset = parseReminderOffset(new FormData(form).get("offsetMinutes"));
  if (offset === undefined) {
    renderError(new Error("알림 시간은 1분 이상의 정수로 입력해주세요."));
    return;
  }
  await runExclusivePanelAction(async () => {
    try {
      unwrapResult(await desktopApi.reminder(id, offset));
      await openDetail(id);
    } catch (error) {
      renderError(error);
    }
  });
}

async function runTaskAction(button, action) {
  if (!(button instanceof HTMLButtonElement)) return;
  await runExclusivePanelAction(async () => {
    try {
      unwrapResult(await action());
    } catch (error) {
      renderError(error);
      return;
    }
    try {
      await openView(currentListView, { throwOnError: true });
    } catch (error) {
      // openView가 실패하기 전에 이미 panelTitle을 목록 뷰 제목으로 바꿔놨다 —
      // 이 안내는 목록이 아니라 처리 결과이므로 제목도 내용에 맞게 다시 맞춘다.
      const detail = error instanceof Error ? error.message : "알 수 없는 오류";
      panelTitle.textContent = "처리 완료";
      renderError(new Error(`처리는 완료됐지만 목록 갱신에 실패했습니다. ${detail}`));
    }
  });
}

async function runExclusivePanelAction(action) {
  return runExclusiveTaskAction(async () => {
    beginThinking();
    const controls = [...panelContent.querySelectorAll("button, input, textarea")];
    const disabledStates = controls.map((control) => control.disabled);
    for (const control of controls) control.disabled = true;
    try {
      await action();
    } finally {
      controls.forEach((control, index) => {
        if (control.isConnected) control.disabled = disabledStates[index];
      });
      endThinking("heart.png");
    }
  });
}

async function runSync(button) {
  beginThinking();
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
    endThinking("sparkle.png");
  }
}

function renderError(error) {
  const message = error instanceof Error ? error.message : "데이터를 불러오지 못했습니다.";
  panelContent.innerHTML = `<div class="state-message error">${escapeHtml(message)}</div>`;
}

function closePanel() {
  stopStudyProgressTimer();
  panel.hidden = true;
}

function viewTitle(view) {
  return ({ today: "오늘 할 일", calendar: "이번 주", inbox: "추천", ask: "물어보기", add: "일정 추가" })[view] ?? "DoDoDo";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
