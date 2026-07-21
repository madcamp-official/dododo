import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Renderer는 브라우저에서 직접 실행하는 JavaScript 모듈이다.
import { desktopApi, formatDateTime, formatSyncSummary, statusLabel, unwrapResult } from "../apps/desktop/src/renderer/character/desktop-api.mjs";

test("desktop Renderer Mock API는 Today·Calendar·Inbox 조회 계약을 제공한다", async () => {
  const today = unwrapResult(await desktopApi.today());
  const calendar = unwrapResult(await desktopApi.calendar());
  const inbox = unwrapResult(await desktopApi.inbox());

  assert.ok(today.items.length > 0);
  assert.equal(typeof today.items[0]?.score, "number");
  assert.equal(typeof today.items[0]?.reason, "string");
  assert.ok(today.items[0]?.item.id);
  assert.ok(calendar.items[0]?.item.id);
  assert.equal(typeof calendar.items[0]?.at, "string");
  assert.ok(inbox.items[0]?.item.id);
  assert.equal("recommendations" in inbox, false);
});

test("desktop Renderer는 날짜 오류와 알려지지 않은 상태를 안전하게 표시한다", () => {
  assert.equal(formatDateTime(undefined), "시간 정보 없음");
  assert.equal(formatDateTime("not-a-date"), "시간 확인 필요");
  assert.equal(statusLabel("unknown"), "확인 필요");
  assert.equal(statusLabel("done"), "완료");
});

test("desktop Ask Mock은 사용자의 질문을 결과에 보존한다", async () => {
  const result = unwrapResult(await desktopApi.ask("이번 주 마감이 뭐야?"));
  assert.match(result.answer, /이번 주 마감이 뭐야/);
  assert.deepEqual(result.evidenceIds, []);
  assert.deepEqual(result.evidence, []);
});

test("desktop Renderer는 실패 Result의 사용자 메시지를 보존한다", () => {
  assert.throws(
    () => unwrapResult({ ok: false, error: { code: "validation", message: "입력을 확인해주세요." } }),
    /입력을 확인해주세요/,
  );
});

test("desktop Sync 문구는 수집·생성 건수로 Renderer에서 조립한다", async () => {
  const result = unwrapResult(await desktopApi.sync());
  assert.deepEqual(result, { collected: 3, created: 1 });
  assert.equal(formatSyncSummary(result), "3개 항목을 확인했고, 새 항목 1개를 저장했어요.");
  assert.equal(formatSyncSummary({ collected: 0, created: 0 }), "확인한 항목이 없습니다.");
  assert.equal(
    formatSyncSummary({ collected: 3, created: 0 }),
    "3개 항목을 확인했고, 새로 저장된 항목은 없어요.",
  );
});
