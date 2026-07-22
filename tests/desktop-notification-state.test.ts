import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Renderer는 브라우저에서 직접 실행하는 JavaScript 모듈이다.
import { createNotificationStore, normalizeNotification, notificationKindLabel, notificationMode } from "../apps/desktop/src/renderer/character/notification-state.mjs";

const createdAt = "2026-07-21T15:00:00.000Z";

test("알림 종류를 즉시 알림과 조용한 알림으로 분류한다", () => {
  for (const kind of ["priority", "conflict", "reminder", "advice", "distraction"]) {
    assert.equal(notificationMode(kind), "immediate");
  }
  for (const kind of ["opportunity", "sync-complete"]) {
    assert.equal(notificationMode(kind), "quiet");
  }
  assert.equal(notificationMode("unknown"), undefined);
});

test("알림 payload를 정규화하고 잘못된 입력은 거절한다", () => {
  assert.deepEqual(normalizeNotification({
    kind: "reminder",
    message: "  과제 마감이 가까워요.  ",
    contextItemId: " task-1 ",
    createdAt,
  }), {
    kind: "reminder",
    message: "과제 마감이 가까워요.",
    contextItemId: "task-1",
    createdAt,
  });

  for (const payload of [
    undefined,
    null,
    [],
    {},
    { kind: "unknown", message: "알림", createdAt },
    { kind: "reminder", message: " ", createdAt },
    { kind: "reminder", message: "알림", createdAt: "not-a-date" },
    { kind: "reminder", message: "알림", contextItemId: " ", createdAt },
  ]) {
    assert.equal(normalizeNotification(payload), undefined);
  }
});

test("즉시 알림은 도착 순서대로 꺼내고 동일 알림은 중복 저장하지 않는다", () => {
  const store = createNotificationStore();
  const first = { kind: "priority", message: "첫 번째", createdAt };
  const second = { kind: "conflict", message: "두 번째", createdAt: "2026-07-21T15:01:00.000Z" };

  assert.equal(store.push(first).accepted, true);
  assert.equal(store.push(first).accepted, false);
  assert.equal(store.push(second).accepted, true);
  assert.equal(store.takeImmediate()?.message, "첫 번째");
  assert.equal(store.takeImmediate()?.message, "두 번째");
  assert.equal(store.hasImmediate(), false);
  assert.equal(store.takeImmediate(), undefined);
});

test("조용한 알림은 unread 배지를 올리고 확인 후 목록은 보존한다", () => {
  const store = createNotificationStore();
  store.push({ kind: "opportunity", message: "새 공모전", createdAt });
  store.push({ kind: "sync-complete", message: "3개 수집", createdAt: "2026-07-21T15:02:00.000Z" });

  assert.equal(store.unreadQuietCount(), 2);
  assert.deepEqual(store.listQuiet().map((event: { message: string }) => event.message), ["새 공모전", "3개 수집"]);
  assert.equal(store.takeImmediate()?.message, "새 공모전");
  assert.equal(store.takeImmediate()?.message, "3개 수집");
  store.markQuietRead();
  assert.equal(store.unreadQuietCount(), 0);
  assert.equal(store.listQuiet().length, 2);
});

test("알림 종류를 사용자용 짧은 문구로 표시한다", () => {
  assert.equal(notificationKindLabel("conflict"), "일정 충돌");
  assert.equal(notificationKindLabel("sync-complete"), "동기화 완료");
  assert.equal(notificationKindLabel("unknown"), "알림");
});
