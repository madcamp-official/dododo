const API_METHODS = {
  today: "getToday",
  calendar: "getCalendar",
  inbox: "getInbox",
  ask: "ask",
  add: "addSubmit",
  detail: "getTaskDetail",
  complete: "completeTask",
  snooze: "snoozeTask",
  update: "updateTask",
  delete: "deleteTask",
  reminder: "setReminderOffset",
  sourceList: "listSources",
  sourceRegister: "registerSource",
  sourceRemove: "removeSource",
  profileGet: "getProfile",
  profileSave: "saveProfile",
  uiStateGet: "getUiState",
  uiStateSet: "setUiState",
  sync: "sync",
};

// Renderer는 preload가 노출한 API만 사용한다. 팩토리를 따로 export해 테스트에서는
// Electron 없이 같은 호출 매핑과 인자 전달을 검증할 수 있게 한다.
export function createDesktopApi(bridgeOrProvider) {
  const resolveBridge = typeof bridgeOrProvider === "function"
    ? bridgeOrProvider
    : () => bridgeOrProvider;
  const invoke = (name, ...args) => {
    const bridge = resolveBridge();
    const method = bridge?.[API_METHODS[name]];
    if (typeof method !== "function") {
      throw new Error("Desktop API를 사용할 수 없습니다. 앱을 다시 실행해주세요.");
    }
    return method(...args);
  };

  return {
    today: () => invoke("today"),
    calendar: () => invoke("calendar"),
    inbox: () => invoke("inbox"),
    ask: (question) => invoke("ask", question),
    add: (input) => invoke("add", input),
    detail: (id) => invoke("detail", id),
    complete: (id) => invoke("complete", id),
    snooze: (id, until) => invoke("snooze", id, until),
    update: (id, input) => invoke("update", id, input),
    delete: (id) => invoke("delete", id),
    reminder: (id, offsetMinutes) => invoke("reminder", id, offsetMinutes),
    sourceList: () => invoke("sourceList"),
    sourceRegister: (type, value) => invoke("sourceRegister", type, value),
    sourceRemove: (id) => invoke("sourceRemove", id),
    profileGet: () => invoke("profileGet"),
    profileSave: (profile) => invoke("profileSave", profile),
    uiStateGet: (key) => invoke("uiStateGet", key),
    uiStateSet: (key, value) => invoke("uiStateSet", key, value),
    sync: () => invoke("sync"),
  };
}

// preload가 Renderer 모듈보다 늦게 준비되는 경우에도 호출 시점의 bridge를 사용한다.
export const desktopApi = createDesktopApi(() => globalThis.window?.desktopApi);

export function createExclusiveActionRunner() {
  let isRunning = false;

  return async (action) => {
    if (isRunning) return false;
    isRunning = true;
    try {
      await action();
      return true;
    } finally {
      isRunning = false;
    }
  };
}

export function unwrapResult(result) {
  if (result?.ok === true) return result.data;
  const message = result?.error?.message;
  throw new Error(typeof message === "string" && message !== "" ? message : "요청 처리에 실패했습니다.");
}

export function formatSyncSummary({ collected, created }) {
  if (collected === 0) return "확인한 항목이 없습니다.";
  if (created === 0) return `${collected}개 항목을 확인했고, 새로 저장된 항목은 없어요.`;
  return `${collected}개 항목을 확인했고, 새 항목 ${created}개를 저장했어요.`;
}

export function formatDateTime(value) {
  if (value === undefined) return "시간 정보 없음";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "시간 확인 필요";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function statusLabel(status) {
  return ({ todo: "할 일", confirmed: "예정", preparing: "준비 중", done: "완료" })[status] ?? "확인 필요";
}

export function tomorrowAtSameTime(now = new Date()) {
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow.toISOString();
}
