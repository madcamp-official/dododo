const IMMEDIATE_KINDS = new Set([
  "priority", "conflict", "reminder", "advice", "distraction", "answer", "daily-summary", "job-failed",
]);
const QUIET_KINDS = new Set(["opportunity", "sync-complete"]);
const ALL_KINDS = new Set([...IMMEDIATE_KINDS, ...QUIET_KINDS]);
const MAX_REMEMBERED_KEYS = 100;
const MAX_QUIET_NOTIFICATIONS = 50;

export function notificationMode(kind) {
  if (IMMEDIATE_KINDS.has(kind)) return "immediate";
  if (QUIET_KINDS.has(kind)) return "quiet";
  return undefined;
}

export function normalizeNotification(payload) {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return undefined;
  if (!ALL_KINDS.has(payload.kind) || typeof payload.message !== "string") return undefined;

  const message = payload.message.trim();
  if (message === "" || typeof payload.createdAt !== "string" || Number.isNaN(Date.parse(payload.createdAt))) {
    return undefined;
  }
  if (payload.contextItemId !== undefined
    && (typeof payload.contextItemId !== "string" || payload.contextItemId.trim() === "")) {
    return undefined;
  }
  if (payload.targetView !== undefined && payload.targetView !== "today") return undefined;

  return {
    kind: payload.kind,
    message,
    createdAt: new Date(payload.createdAt).toISOString(),
    ...(payload.contextItemId === undefined ? {} : { contextItemId: payload.contextItemId.trim() }),
    ...(payload.targetView === undefined ? {} : { targetView: payload.targetView }),
  };
}

export function createNotificationStore() {
  const immediate = [];
  const quiet = [];
  const rememberedKeys = new Set();
  const keyOrder = [];
  let unreadQuietCount = 0;

  const remember = (key) => {
    rememberedKeys.add(key);
    keyOrder.push(key);
    if (keyOrder.length > MAX_REMEMBERED_KEYS) {
      rememberedKeys.delete(keyOrder.shift());
    }
  };

  return {
    push(payload) {
      const event = normalizeNotification(payload);
      if (event === undefined) return { accepted: false };

      const key = [event.kind, event.message, event.contextItemId ?? "", event.createdAt].join("|");
      if (rememberedKeys.has(key)) return { accepted: false };
      remember(key);

      const mode = notificationMode(event.kind);
      // 모든 알림은 캐릭터 말풍선으로 즉시 보여준다. quiet 종류는 사용자가 나중에
      // 다시 확인할 수 있도록 배지 목록에도 함께 보존한다.
      if (event.kind === "answer") {
        // 연속 질문의 이전 답변이 아직 대기 중이면 최신 답변만 남기고, 일반 알림보다
        // 먼저 꺼내 현재 답변 말풍선을 즉시 교체할 수 있게 한다.
        for (let index = immediate.length - 1; index >= 0; index -= 1) {
          if (immediate[index].kind === "answer") immediate.splice(index, 1);
        }
        immediate.unshift(event);
      } else {
        immediate.push(event);
      }
      if (mode === "quiet") {
        quiet.push(event);
        if (quiet.length > MAX_QUIET_NOTIFICATIONS) quiet.shift();
        unreadQuietCount = Math.min(unreadQuietCount + 1, MAX_QUIET_NOTIFICATIONS);
      }
      return { accepted: true, mode, event };
    },
    takeImmediate() {
      return immediate.shift();
    },
    hasImmediate() {
      return immediate.length > 0;
    },
    listQuiet() {
      return [...quiet];
    },
    unreadQuietCount() {
      return unreadQuietCount;
    },
    markQuietRead() {
      unreadQuietCount = 0;
    },
  };
}

export function notificationKindLabel(kind) {
  return ({
    priority: "우선 확인",
    conflict: "일정 충돌",
    reminder: "마감 알림",
    opportunity: "새 추천",
    "sync-complete": "동기화 완료",
    advice: "조언",
    distraction: "집중 확인",
    answer: "답변",
    "daily-summary": "오늘 요약",
  })[kind] ?? "알림";
}
