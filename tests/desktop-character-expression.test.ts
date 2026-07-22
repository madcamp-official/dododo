import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Renderer 브라우저에서 직접 실행하는 JavaScript 모듈이다.
import { notificationExpression, restingExpression } from "../apps/desktop/src/renderer/character/character-expression.mjs";

test("알림 종류에 맞는 캐릭터 표정을 선택한다", () => {
  assert.equal(notificationExpression("reminder").asset, "alert.png");
  assert.equal(notificationExpression("conflict").asset, "worried.png");
  assert.equal(notificationExpression("opportunity").asset, "happy.png");
  assert.equal(notificationExpression("sync-complete").asset, "cheering.png");
  assert.equal(notificationExpression("advice").asset, "point.png");
  assert.equal(notificationExpression("daily-summary").asset, "greeting.png");
});

test("알 수 없는 알림도 기본 알림 표정으로 안전하게 표시한다", () => {
  assert.deepEqual(notificationExpression("unknown"), {
    asset: "alert.png",
    alt: "알림을 전하는 DoDoDo 도토리 캐릭터",
  });
});

test("알림이 끝나면 공부 상태에 맞는 표정으로 복귀한다", () => {
  assert.equal(restingExpression(false).asset, "idle.png");
  assert.equal(restingExpression(true).asset, "reading.png");
});
