import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Renderer는 브라우저에서 직접 실행하는 JavaScript 모듈이다.
import { createDesktopApi, formatDateTime, formatSyncSummary, statusLabel, tomorrowAtSameTime, unwrapResult } from "../apps/desktop/src/renderer/character/desktop-api.mjs";

test("desktop Renderer API는 preload 메서드와 인자를 그대로 연결한다", async () => {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const result = { ok: true, data: {} };
  const bridge = Object.fromEntries([
    "getToday", "getCalendar", "getInbox", "ask", "addSubmit",
    "getTaskDetail", "completeTask", "snoozeTask", "sync",
  ].map((method) => [method, (...args: unknown[]) => {
    calls.push({ method, args });
    return Promise.resolve(result);
  }]));
  const api = createDesktopApi(bridge);
  const addInput = { title: "팀 회의", date: "2026-07-22", time: "15:00" };

  await api.today();
  await api.calendar();
  await api.inbox();
  await api.ask("이번 주 마감은?");
  await api.add(addInput);
  await api.detail("task-1");
  await api.complete("task-1");
  await api.snooze("task-1", "2026-07-22T09:00:00.000Z");
  await api.sync();

  assert.deepEqual(calls, [
    { method: "getToday", args: [] },
    { method: "getCalendar", args: [] },
    { method: "getInbox", args: [] },
    { method: "ask", args: ["이번 주 마감은?"] },
    { method: "addSubmit", args: [addInput] },
    { method: "getTaskDetail", args: ["task-1"] },
    { method: "completeTask", args: ["task-1"] },
    { method: "snoozeTask", args: ["task-1", "2026-07-22T09:00:00.000Z"] },
    { method: "sync", args: [] },
  ]);
});

test("desktop Renderer API는 preload가 없으면 재실행 안내를 표시한다", () => {
  const api = createDesktopApi(undefined);
  assert.throws(() => api.today(), /앱을 다시 실행해주세요/);
});

test("desktop Renderer는 날짜 오류와 알려지지 않은 상태를 안전하게 표시한다", () => {
  assert.equal(formatDateTime(undefined), "시간 정보 없음");
  assert.equal(formatDateTime("not-a-date"), "시간 확인 필요");
  assert.equal(statusLabel("unknown"), "확인 필요");
  assert.equal(statusLabel("done"), "완료");
});

test("desktop Renderer는 실패 Result의 사용자 메시지를 보존한다", () => {
  assert.throws(
    () => unwrapResult({ ok: false, error: { code: "validation", message: "입력을 확인해주세요." } }),
    /입력을 확인해주세요/,
  );
});

test("desktop Sync 문구는 수집·생성 건수로 Renderer에서 조립한다", () => {
  assert.equal(formatSyncSummary({ collected: 3, created: 1 }), "3개 항목을 확인했고, 새 항목 1개를 저장했어요.");
  assert.equal(formatSyncSummary({ collected: 0, created: 0 }), "확인한 항목이 없습니다.");
  assert.equal(
    formatSyncSummary({ collected: 3, created: 0 }),
    "3개 항목을 확인했고, 새로 저장된 항목은 없어요.",
  );
});

test("내일 알림 시각은 로컬 날짜 기준 하루 뒤 같은 시각이다", () => {
  const now = new Date(2026, 6, 21, 15, 30, 0, 0);
  const tomorrow = new Date(tomorrowAtSameTime(now));
  assert.equal(tomorrow.getFullYear(), 2026);
  assert.equal(tomorrow.getMonth(), 6);
  assert.equal(tomorrow.getDate(), 22);
  assert.equal(tomorrow.getHours(), 15);
  assert.equal(tomorrow.getMinutes(), 30);
});
