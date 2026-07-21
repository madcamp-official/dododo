import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Renderer는 브라우저에서 직접 실행하는 JavaScript 모듈이다.
import { desktopApi, formatDateTime, statusLabel } from "../apps/desktop/src/renderer/character/desktop-api.mjs";

test("desktop Renderer Mock API는 Today·Calendar·Inbox 조회 계약을 제공한다", async () => {
  const today = await desktopApi.today();
  const calendar = await desktopApi.calendar();
  const inbox = await desktopApi.inbox();

  assert.ok(today.items.length > 0);
  assert.deepEqual(calendar.items, today.items);
  assert.ok(inbox.recommendations.length > 0);
});

test("desktop Renderer는 날짜 오류와 알려지지 않은 상태를 안전하게 표시한다", () => {
  assert.equal(formatDateTime(undefined), "시간 정보 없음");
  assert.equal(formatDateTime("not-a-date"), "시간 확인 필요");
  assert.equal(statusLabel("unknown"), "확인 필요");
  assert.equal(statusLabel("done"), "완료");
});

test("desktop Ask Mock은 사용자의 질문을 결과에 보존한다", async () => {
  const result = await desktopApi.ask("이번 주 마감이 뭐야?");
  assert.match(result.answer, /이번 주 마감이 뭐야/);
});
