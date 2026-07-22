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
} from "./notification-state.mjs";
import { parseReminderOffset, scheduleItemToForm } from "./schedule-form.mjs";
import { profileFromFormData, profileToForm } from "./profile-form.mjs";

const character = document.querySelector(".character");
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
const NOTIFICATION_DISPLAY_MS = 6_000;
let activeNotification;
let notificationTimer;

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
    && event.target.closest("[data-popup-menu], [data-panel], [data-menu-toggle], [data-notification-bubble], [data-notification-badge]") !== null;
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
  const willOpen = popupMenu.hidden;
  popupMenu.hidden = !willOpen;
  panel.hidden = true;
});

notificationBadge?.addEventListener("click", renderNotificationCenter);
document.querySelector("[data-dismiss-notification]")?.addEventListener("click", dismissActiveNotification);
notificationDetail?.addEventListener("click", () => {
  const contextItemId = activeNotification?.contextItemId;
  dismissActiveNotification();
  if (contextItemId !== undefined) openDetail(contextItemId);
});

const unsubscribeNotifications = window.desktopEvents?.onNotification?.(handleNotification);
window.addEventListener("beforeunload", () => {
  if (notificationTimer !== undefined) window.clearTimeout(notificationTimer);
  unsubscribeNotifications?.();
}, { once: true });

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

function handleNotification(payload) {
  const result = notificationStore.push(payload);
  if (!result.accepted) return;
  if (result.mode === "quiet") {
    updateNotificationBadge();
  }
  showNextNotification();
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
  notificationKind.textContent = notificationKindLabel(next.kind);
  notificationMessage.textContent = next.message;
  notificationDetail.hidden = next.contextItemId === undefined;
  notificationBubble.hidden = false;
  notificationTimer = window.setTimeout(dismissActiveNotification, NOTIFICATION_DISPLAY_MS);
}

function dismissActiveNotification() {
  if (notificationTimer !== undefined) {
    window.clearTimeout(notificationTimer);
    notificationTimer = undefined;
  }
  activeNotification = undefined;
  if (notificationBubble instanceof HTMLElement) notificationBubble.hidden = true;
  showNextNotification();
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
    const buttons = target.querySelectorAll("button");
    for (const button of buttons) button.disabled = true;
    try {
      unwrapResult(await desktopApi.update(item.id, input));
      await openDetail(item.id);
    } catch (error) {
      renderError(error);
    } finally {
      for (const button of buttons) if (button.isConnected) button.disabled = false;
    }
  });
}

async function runDeleteSchedule(button, item) {
  if (!(button instanceof HTMLButtonElement)) return;
  if (!window.confirm(`“${item.title}”을(를) 삭제할까요? 목록에서 숨겨지며 근거는 보존됩니다.`)) return;
  button.disabled = true;
  try {
    unwrapResult(await desktopApi.delete(item.id));
    await openView(currentListView);
  } catch (error) {
    renderError(error);
  } finally {
    if (button.isConnected) button.disabled = false;
  }
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
  const submit = form.querySelector("button[type='submit']");
  if (submit instanceof HTMLButtonElement) submit.disabled = true;
  try {
    unwrapResult(await desktopApi.reminder(id, offset));
    await openDetail(id);
  } catch (error) {
    renderError(error);
  } finally {
    if (submit instanceof HTMLButtonElement && submit.isConnected) submit.disabled = false;
  }
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
        // openView가 실패하기 전에 이미 panelTitle을 목록 뷰 제목으로 바꿔놨다 —
        // 이 안내는 목록이 아니라 처리 결과이므로 제목도 내용에 맞게 다시 맞춘다.
        const detail = error instanceof Error ? error.message : "알 수 없는 오류";
        panelTitle.textContent = "처리 완료";
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
      <button type="button" data-settings-profile>프로필 <span>›</span></button>
      <button type="button">일정 관리 <span>›</span></button>
      <button type="button" data-settings-source>Source 관리 <span>›</span></button>
    </div>
    <p class="hint">전체 일정 관리 화면은 다음 단계에서 연결할 예정입니다.</p>`;
  panelContent.querySelector("[data-settings-profile]")?.addEventListener("click", () => renderProfileSettings());
  panelContent.querySelector("[data-settings-source]")?.addEventListener("click", () => renderSourceSettings());
}

async function renderProfileSettings(notice) {
  panelTitle.textContent = "프로필 설정";
  panelContent.innerHTML = '<div class="state-message">프로필을 불러오는 중...</div>';
  try {
    const profile = profileToForm(unwrapResult(await desktopApi.profileGet()));
    panelContent.innerHTML = `
      ${notice === undefined ? "" : `<p class="restart-notice">${escapeHtml(notice)}</p>`}
      <form class="profile-form" data-profile-form>
        <p class="state-message error compact" data-profile-error hidden></p>
        <div class="form-row">
          <div class="form-field"><label for="profile-school">학교</label><input id="profile-school" name="school" value="${escapeHtml(profile.school)}" required /></div>
          <div class="form-field"><label for="profile-major">전공</label><input id="profile-major" name="major" value="${escapeHtml(profile.major)}" required /></div>
        </div>
        <div class="form-field"><label for="profile-year">학년</label><input id="profile-year" name="year" value="${escapeHtml(profile.year)}" placeholder="예: 3학년" required /></div>
        ${profileListField("profile-interests", "interests", "관심 분야", profile.interests, "AI, 창업")}
        ${profileListField("profile-activities", "activityTypes", "선호 활동", profile.activityTypes, "해커톤, 공모전")}
        ${profileListField("profile-locations", "preferredLocations", "선호 장소", profile.preferredLocations, "서울, 교내")}
        ${profileListField("profile-constraints", "explicitConstraints", "제외 조건", profile.explicitConstraints, "대학원생 전용")}
        <fieldset class="quiet-hours-field">
          <label class="checkbox-label"><input name="quietHoursEnabled" type="checkbox" ${profile.quietHoursEnabled ? "checked" : ""} data-quiet-hours-toggle /> 방해 금지 시간 사용</label>
          <div class="form-row" data-quiet-hours-fields>
            <div class="form-field"><label for="quiet-start">시작</label><input id="quiet-start" name="quietHoursStart" type="time" value="${escapeHtml(profile.quietHoursStart)}" /></div>
            <div class="form-field"><label for="quiet-end">종료</label><input id="quiet-end" name="quietHoursEnd" type="time" value="${escapeHtml(profile.quietHoursEnd)}" /></div>
          </div>
        </fieldset>
        <button class="primary-button" type="submit">프로필 저장</button>
      </form>
      <p class="hint">여러 값은 쉼표로 구분해주세요. 프로필은 추천 관련도와 Quiet Hours 정책에 사용됩니다.</p>`;
    const form = panelContent.querySelector("[data-profile-form]");
    form?.addEventListener("submit", runProfileSave);
    form?.querySelector("[data-quiet-hours-toggle]")?.addEventListener("change", updateQuietHoursFields);
    updateQuietHoursFields.call(form?.querySelector("[data-quiet-hours-toggle]"));
  } catch (error) {
    renderError(error);
  }
}

function profileListField(id, name, label, value, placeholder) {
  return `<div class="form-field"><label for="${id}">${label}</label><input id="${id}" name="${name}" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" /></div>`;
}

function updateQuietHoursFields() {
  const enabled = this instanceof HTMLInputElement && this.checked;
  panelContent.querySelectorAll("[data-quiet-hours-fields] input").forEach((input) => {
    input.disabled = !enabled;
    input.required = enabled;
  });
}

async function runProfileSave(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!(form instanceof HTMLFormElement)) return;
  const submit = form.querySelector("button[type='submit']");
  if (submit instanceof HTMLButtonElement) submit.disabled = true;
  try {
    const profile = profileFromFormData(new FormData(form));
    unwrapResult(await desktopApi.profileSave(profile));
    await renderProfileSettings("프로필을 저장했습니다.");
  } catch (error) {
    const target = form.querySelector("[data-profile-error]");
    if (target instanceof HTMLElement) {
      target.textContent = error instanceof Error ? error.message : "프로필을 저장하지 못했습니다.";
      target.hidden = false;
    }
  } finally {
    if (submit instanceof HTMLButtonElement && submit.isConnected) submit.disabled = false;
  }
}

async function renderSourceSettings(notice) {
  panelTitle.textContent = "Source 관리";
  panelContent.innerHTML = '<div class="state-message">등록된 Source를 불러오는 중...</div>';
  try {
    const { sources } = unwrapResult(await desktopApi.sourceList());
    const list = sources.length === 0
      ? '<p class="state-message compact">등록된 Source가 없습니다.</p>'
      : `<div class="source-list">${sources.map((source) => `
          <article class="source-card">
            <div>
              <strong>${escapeHtml(sourceTypeLabel(source.id))}</strong>
              <small>${escapeHtml(source.value)}</small>
            </div>
            <button class="danger-button" type="button" data-source-remove="${escapeHtml(source.id)}">삭제</button>
          </article>`).join("")}</div>`;
    panelContent.innerHTML = `
      ${notice === undefined ? "" : `<p class="restart-notice">${escapeHtml(notice)}</p>`}
      ${list}
      <form class="source-form" data-source-form>
        <label for="school-site-url">학교 사이트 URL</label>
        <input id="school-site-url" name="value" type="url" placeholder="https://school.example/notices" required />
        <button class="primary-button" type="submit">학교 사이트 등록</button>
      </form>
      <p class="hint">학교 이메일과 LMS 등록은 필수 설정값이 확정되지 않아 아직 지원하지 않습니다.</p>`;

    panelContent.querySelector("[data-source-form]")?.addEventListener("submit", runSourceRegister);
    panelContent.querySelectorAll("[data-source-remove]").forEach((button) => {
      button.addEventListener("click", () => runSourceRemove(button));
    });
  } catch (error) {
    renderError(error);
  }
}

async function runSourceRegister(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!(form instanceof HTMLFormElement)) return;
  const value = new FormData(form).get("value")?.toString().trim() ?? "";
  const submit = form.querySelector("button[type='submit']");
  if (submit instanceof HTMLButtonElement) submit.disabled = true;
  try {
    const result = unwrapResult(await desktopApi.sourceRegister("school-site", value));
    await renderSourceSettings(result.restartRequired ? "등록했습니다. 앱을 재시작하면 Source 설정이 적용됩니다." : undefined);
  } catch (error) {
    renderError(error);
  } finally {
    if (submit instanceof HTMLButtonElement && submit.isConnected) submit.disabled = false;
  }
}

async function runSourceRemove(button) {
  if (!(button instanceof HTMLButtonElement)) return;
  const id = button.dataset.sourceRemove;
  if (id === undefined || !window.confirm(`${sourceTypeLabel(id)} Source를 삭제할까요?`)) return;
  button.disabled = true;
  try {
    const result = unwrapResult(await desktopApi.sourceRemove(id));
    await renderSourceSettings(result.restartRequired ? "삭제했습니다. 앱을 재시작하면 Source 설정이 적용됩니다." : undefined);
  } catch (error) {
    renderError(error);
  } finally {
    if (button.isConnected) button.disabled = false;
  }
}

function sourceTypeLabel(id) {
  return ({ "school-site": "학교 사이트", "school-email": "학교 이메일", lms: "LMS" })[id] ?? "Source";
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
