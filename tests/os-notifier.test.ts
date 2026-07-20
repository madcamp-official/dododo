import assert from "node:assert/strict";
import test from "node:test";

import { escapePowerShellSingleQuoted, WindowsOsNotifier } from "../packages/scheduler/src/index.ts";
import type { Recommendation } from "../packages/shared/src/index.ts";

function sampleRecommendation(overrides: Partial<Recommendation> = {}): Recommendation {
  return {
    id: "rec-1",
    contextItemId: "task-1",
    action: "과제를 확인하세요",
    reason: "마감이 가까움",
    score: 42,
    evidenceIds: [],
    createdAt: "2026-07-20T00:00:00+09:00",
    ...overrides,
  };
}

test("escapePowerShellSingleQuoted는 작은따옴표를 두 번으로 이스케이프한다", () => {
  assert.equal(escapePowerShellSingleQuoted("plain"), "plain");
  assert.equal(escapePowerShellSingleQuoted("it's"), "it''s");
  assert.equal(
    escapePowerShellSingleQuoted("'; Remove-Item -Recurse -Force C:\\; '"),
    "''; Remove-Item -Recurse -Force C:\\; ''",
  );
});

test("WindowsOsNotifier는 항상 콘솔에 먼저 로그를 남긴다", async () => {
  const originalLog = console.log;
  const logged: string[] = [];
  console.log = (...args: unknown[]) => { logged.push(args.join(" ")); };

  try {
    const notifier = new WindowsOsNotifier(async () => {});
    await notifier.send(sampleRecommendation());
  } finally {
    console.log = originalLog;
  }

  assert.ok(logged.some((line) => line.includes("과제를 확인하세요")));
});

test("WindowsOsNotifier는 주입된 showBalloon을 action/reason으로 호출한다", async () => {
  const calls: Array<{ title: string; message: string }> = [];
  const notifier = new WindowsOsNotifier(async (title, message) => {
    calls.push({ title, message });
  });

  await notifier.send(sampleRecommendation({ action: "제목", reason: "이유" }));

  assert.deepEqual(calls, [{ title: "제목", message: "이유" }]);
});

test("WindowsOsNotifier는 OS 알림 실패에도 send() 자체를 실패시키지 않는다", async () => {
  const notifier = new WindowsOsNotifier(async () => {
    throw new Error("표시 실패");
  });

  await assert.doesNotReject(() => notifier.send(sampleRecommendation()));
});
