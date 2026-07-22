import assert from "node:assert/strict";
import test from "node:test";

import { createPanelWindowRouteGate } from "../apps/desktop/src/main/windows/panelWindowRouteGate.ts";

test("markReady()는 그 시점까지의 최신 route를 반환한다(로드 전 navigate가 여러 번 겹쳐도)", () => {
  const gate = createPanelWindowRouteGate({ view: "today" });

  // 창이 아직 로딩 중일 때 두 번째 요청(calendar)이 들어온 상황을 재현한다.
  const firstUpdate = gate.setRoute({ view: "calendar" });
  assert.equal(firstUpdate.shouldSendNow, false); // 아직 안 열렸으니 지금 보내면 유실된다

  const flushed = gate.markReady();
  assert.deepEqual(flushed, { view: "calendar" }); // stale한 초기 route(today)가 아니라 최신 값

  void gate;
});

test("ready 이후의 setRoute는 즉시 전송 대상임을 알린다", () => {
  const gate = createPanelWindowRouteGate({ view: "today" });
  gate.markReady();

  const update = gate.setRoute({ view: "inbox" });
  assert.equal(update.shouldSendNow, true);
});

test("navigate 없이 바로 ready되면 최초 route를 그대로 돌려준다", () => {
  const gate = createPanelWindowRouteGate({ view: "detail", itemId: "task-1" });
  assert.deepEqual(gate.markReady(), { view: "detail", itemId: "task-1" });
});

test("로드 전 navigate가 여러 번 겹쳐도 가장 마지막 값만 남는다", () => {
  const gate = createPanelWindowRouteGate({ view: "today" });
  gate.setRoute({ view: "calendar" });
  gate.setRoute({ view: "inbox" });
  gate.setRoute({ view: "detail", itemId: "task-9" });

  assert.deepEqual(gate.markReady(), { view: "detail", itemId: "task-9" });
});
