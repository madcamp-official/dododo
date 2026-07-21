import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Renderer 브라우저에서 직접 실행하는 JavaScript 모듈이다.
import { groupScheduledItems } from "../apps/desktop/src/renderer/character/schedule-management.mjs";

test("이번 주 항목을 Asia/Seoul 날짜별로 입력 순서대로 묶는다", () => {
  const entries = [
    { item: { id: "a" }, at: "2026-07-20T15:30:00.000Z" },
    { item: { id: "b" }, at: "2026-07-21T01:00:00.000Z" },
    { item: { id: "c" }, at: "2026-07-21T16:00:00.000Z" },
  ];
  const groups = groupScheduledItems(entries);

  assert.equal(groups.length, 2);
  assert.equal(groups[0].key, "2026-07-21");
  assert.deepEqual(groups[0].entries.map((entry: { item: { id: string } }) => entry.item.id), ["a", "b"]);
  assert.equal(groups[1].key, "2026-07-22");
  assert.deepEqual(groups[1].entries.map((entry: { item: { id: string } }) => entry.item.id), ["c"]);
});

test("날짜가 잘못된 항목도 사라지지 않고 확인 필요 그룹에 남긴다", () => {
  const entries = [
    { item: { id: "valid" }, at: "2026-07-21T01:00:00.000Z" },
    { item: { id: "invalid" }, at: "not-a-date" },
  ];
  const groups = groupScheduledItems(entries);
  assert.equal(groups[1].key, "invalid");
  assert.equal(groups[1].label, "날짜 확인 필요");
  assert.equal(groups[1].entries[0].item.id, "invalid");
});

test("빈 일정은 빈 그룹 배열을 반환한다", () => {
  assert.deepEqual(groupScheduledItems([]), []);
});
