import assert from "node:assert/strict";
import test from "node:test";

import { parsePanelRoute } from "../apps/desktop/src/main/windows/panelPayload.ts";

test("허용된 view만 통과시킨다", () => {
  for (const view of ["today", "calendar", "inbox", "ask", "detail"]) {
    assert.deepEqual(parsePanelRoute({ view }), { view });
  }
});

test("허용되지 않은 view는 거절한다", () => {
  assert.equal(parsePanelRoute({ view: "settings" }), undefined);
  assert.equal(parsePanelRoute({ view: "https://evil.example" }), undefined);
  assert.equal(parsePanelRoute({ view: "../../etc/passwd" }), undefined);
});

test("view가 없거나 객체가 아니면 거절한다", () => {
  assert.equal(parsePanelRoute(undefined), undefined);
  assert.equal(parsePanelRoute(null), undefined);
  assert.equal(parsePanelRoute("today"), undefined);
  assert.equal(parsePanelRoute({}), undefined);
});

test("itemId는 짧은 문자열만 허용한다", () => {
  assert.deepEqual(parsePanelRoute({ view: "detail", itemId: "task-1" }), { view: "detail", itemId: "task-1" });
  assert.equal(parsePanelRoute({ view: "detail", itemId: "" }), undefined);
  assert.equal(parsePanelRoute({ view: "detail", itemId: 123 }), undefined);
  assert.equal(parsePanelRoute({ view: "detail", itemId: "a\nb" }), undefined);
  assert.equal(parsePanelRoute({ view: "detail", itemId: "x".repeat(201) }), undefined);
});

test("itemId 없이 view만 있어도 유효하다", () => {
  assert.deepEqual(parsePanelRoute({ view: "today" }), { view: "today" });
});
