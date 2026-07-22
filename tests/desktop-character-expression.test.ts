import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Renderer 브라우저에서 직접 실행하는 JavaScript 모듈이다.
import { notificationEffect, notificationExpression, restingExpression } from "../apps/desktop/src/renderer/character/character-expression.mjs";

test("알림 종류에 맞는 캐릭터 표정을 선택한다", () => {
  assert.equal(notificationExpression("priority").asset, "alert.png");
  assert.equal(notificationExpression("reminder").asset, "alert.png");
  assert.equal(notificationExpression("conflict").asset, "worried.png");
  assert.equal(notificationExpression("distraction").asset, "worried.png");
  assert.equal(notificationExpression("opportunity").asset, "happy.png");
  assert.equal(notificationExpression("sync-complete").asset, "cheering.png");
  assert.equal(notificationExpression("advice").asset, "point.png");
  assert.equal(notificationExpression("daily-summary").asset, "greeting.png");
});

test("알 수 없는 알림도 기본 알림 표정으로 안전하게 표시한다", () => {
  assert.deepEqual(notificationExpression("unknown"), {
    asset: "alert.png",
    alt: "알림을 전하는 DoToRi 도토리 캐릭터",
  });
});

test("알림이 끝나면 공부 상태에 맞는 표정으로 복귀한다", () => {
  assert.equal(restingExpression(false).asset, "idle.png");
  assert.equal(restingExpression(true).asset, "reading.png");
});

test("알림 종류에 맞는 캐릭터 이펙트를 선택한다", () => {
  assert.equal(notificationEffect("priority"), "exclamation.png");
  assert.equal(notificationEffect("reminder"), "exclamation.png");
  assert.equal(notificationEffect("conflict"), "sweat.png");
  assert.equal(notificationEffect("distraction"), "sweat.png");
  assert.equal(notificationEffect("opportunity"), "sparkle.png");
  assert.equal(notificationEffect("sync-complete"), "sparkle.png");
  assert.equal(notificationEffect("advice"), "question.png");
  assert.equal(notificationEffect("daily-summary"), "heart.png");
  assert.equal(notificationEffect("unknown"), undefined);
});
