import assert from "node:assert/strict";
import test from "node:test";

import { runWatch } from "../apps/cli/src/commands/watch.ts";
import { createCliContainer, emptyProfile } from "../apps/cli/src/runtime/container.ts";
import { isReminderRecommendationId } from "../apps/cli/src/runtime/reminderCheck.ts";
import { runWatchLoop } from "../apps/cli/src/runtime/watchLoop.ts";
import { runWatchTick } from "../apps/cli/src/runtime/watchTick.ts";
import type { ContextItem, Notifier, Recommendation } from "../packages/shared/src/index.ts";

// 모킹 프레임워크 대신 실제 객체 하나를 만들어 send() 호출을 기록한다(repo 관례).
class RecordingNotifier implements Notifier {
  readonly sent: Recommendation[] = [];
  async send(recommendation: Recommendation): Promise<void> {
    this.sent.push(recommendation);
  }
}

// 리마인더로 온 Recommendation만 전달 실패로 만든다 — 일반 추천 처리는 그대로 둬서
// "리마인더 전달 실패가 리마인더 자신의 발송 완료 커밋만 막는지"를 정확히 격리해 본다.
class FailingReminderNotifier implements Notifier {
  readonly sent: Recommendation[] = [];
  async send(recommendation: Recommendation): Promise<void> {
    if (isReminderRecommendationId(recommendation.id)) throw new Error("리마인더 전달 실패");
    this.sent.push(recommendation);
  }
}

function taskDueSoon(id: string, now: Date): ContextItem {
  return {
    id,
    kind: "task",
    title: `마감 임박 Task ${id}`,
    status: "confirmed",
    deadline: new Date(now.getTime() + 60 * 60 * 1000).toISOString(), // 1시간 뒤(기본 24시간 오프셋 안)
    requirements: [],
    tags: [],
    priority: 0,
    confidence: 1,
    evidenceIds: [],
    metadata: {},
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

function scheduledEvent(id: string, startAt: string, endAt: string): ContextItem {
  return {
    id,
    kind: "event",
    title: `일정 ${id}`,
    status: "confirmed",
    startAt,
    endAt,
    requirements: [],
    tags: [],
    priority: 0,
    confidence: 1,
    evidenceIds: [],
    metadata: {},
    createdAt: startAt,
    updatedAt: startAt,
  };
}

function captureConsoleLog(): { lines: string[]; restore: () => void } {
  const original = console.log;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => { lines.push(args.join(" ")); };
  return { lines, restore: () => { console.log = original; } };
}

test("runWatchTick은 첫 실행에서 Source를 동기화하고 알림을 보낸다", async () => {
  const container = createCliContainer({ databasePath: ":memory:" });

  const result = await runWatchTick(container, new Date("2026-07-20T10:00:00+09:00"));

  assert.equal(result.syncedSources.length, container.collectors.length);
  for (const synced of result.syncedSources) assert.deepEqual(synced.errors, []);
  assert.ok(result.notified.length > 0);
  assert.deepEqual(result.heldForQuietHours, []);
});

test("runWatchTick은 gate를 통과한 추천을 notifier.send로 전달한다", async () => {
  const container = createCliContainer({ databasePath: ":memory:" });
  const notifier = new RecordingNotifier();
  container.notifier = notifier;

  const result = await runWatchTick(container, new Date("2026-07-20T10:00:00+09:00"));

  assert.equal(notifier.sent.length, result.notified.length);
  assert.deepEqual(notifier.sent.map((r) => r.id).sort(), result.notified.map((r) => r.id).sort());
});

test("runWatchTick은 tick마다 Job Queue에 밀린 작업을 drain한다(docs/llm-architecture.md §5)", async () => {
  const container = createCliContainer({ databasePath: ":memory:" });
  const now = new Date("2026-07-20T10:00:00+09:00");
  // RawItem이 없는 대상을 가리키는 extract_facts Job — createExtractFactsJobHandler는
  // 이런 경우 "처리할 대상 없음"으로 보고 성공 처리한다(재처리 대상이 사라졌을 때와
  // 같은 경로). 여기서는 watchTick이 실제로 큐를 drain하는지만 확인한다.
  await container.jobQueue.enqueue({
    id: "extract_facts:missing-raw-item",
    type: "extract_facts",
    inputRef: "missing-raw-item",
    now,
  });

  const result = await runWatchTick(container, now);

  assert.deepEqual(result.deadLetteredJobs, []);
  // 이번 tick에서 처리(완료)됐으니 다음에 다시 claim되지 않는다.
  assert.equal(await container.jobQueue.claimNext(["extract_facts"], now, 60_000), undefined);
});

test("runWatchTick은 변경 없는 RawItem을 다음 tick에서 재분석하지 않는다(팀 리뷰 반영)", async () => {
  const container = createCliContainer({ databasePath: ":memory:" });
  await runWatchTick(container, new Date("2026-07-20T10:00:00+09:00"));

  const items = await container.repository.listContextItems();
  assert.ok(items.length > 0);
  const beforeUpdatedAt = new Map(items.map((item) => [item.id, item.updatedAt]));
  const beforeHistoryLengths = await Promise.all(
    items.map(async (item) => [item.id, (await container.pipeline.evidenceStore.listContextHistory(item.id)).length] as const),
  );

  const second = await runWatchTick(container, new Date("2026-07-20T10:01:00+09:00"));

  for (const synced of second.syncedSources) {
    assert.equal(synced.collected, 0, `${synced.sourceId}는 변경 없어 이번 tick엔 재수집 대상이 없어야 함`);
    assert.equal(synced.created, 0);
    assert.equal(synced.updated, 0);
  }

  const afterItems = await container.repository.listContextItems();
  for (const item of afterItems) {
    assert.equal(item.updatedAt, beforeUpdatedAt.get(item.id), `${item.id}의 updatedAt이 바뀌면 안 됨`);
  }
  for (const [id, before] of beforeHistoryLengths) {
    const after = await container.pipeline.evidenceStore.listContextHistory(id);
    assert.equal(after.length, before, `${id}의 변경 이력이 재분석 없이 그대로여야 함`);
  }
});

test("runWatchTick은 30분 이내 재실행에서 같은 항목을 다시 알리지 않는다", async () => {
  const container = createCliContainer({ databasePath: ":memory:" });
  const first = await runWatchTick(container, new Date("2026-07-20T10:00:00+09:00"));
  assert.ok(first.notified.length > 0);

  const second = await runWatchTick(container, new Date("2026-07-20T10:01:00+09:00"));

  assert.deepEqual(second.notified, []);
});

test("runWatchTick은 Quiet Hours 안이면 알림을 보류한다", async () => {
  const container = createCliContainer({ databasePath: ":memory:" });
  await container.profileRepository.save({ ...emptyProfile(), quietHours: { start: "00:00", end: "23:59" } });

  const result = await runWatchTick(container, new Date("2026-07-20T10:00:00+09:00"));

  assert.deepEqual(result.notified, []);
  assert.ok(result.heldForQuietHours.length > 0);
  for (const held of result.heldForQuietHours) assert.ok(held.suppressedUntil !== undefined);
});

test("runWatchLoop은 maxIterations:1이면 실제 대기 없이 즉시 끝난다", async () => {
  const container = createCliContainer({ databasePath: ":memory:" });
  let sleepCalls = 0;

  const summary = await runWatchLoop(container, {
    intervalMs: 999_999_999,
    maxIterations: 1,
    now: () => new Date("2026-07-20T10:00:00+09:00"),
    sleep: async () => {
      sleepCalls += 1;
    },
  });

  assert.equal(summary.results.length, 1);
  assert.equal(summary.tickCount, 1);
  assert.equal(sleepCalls, 0);
});

test("runWatchLoop은 마지막 iteration 뒤엔 sleep을 호출하지 않는다", async () => {
  const container = createCliContainer({ databasePath: ":memory:" });
  const sleepCalls: number[] = [];

  const summary = await runWatchLoop(container, {
    intervalMs: 1234,
    maxIterations: 3,
    now: () => new Date("2026-07-20T10:00:00+09:00"),
    sleep: async (ms) => {
      sleepCalls.push(ms);
    },
  });

  assert.equal(summary.results.length, 3);
  assert.equal(summary.tickCount, 3);
  assert.deepEqual(sleepCalls, [1234, 1234]);
});

test("runWatchLoop은 이미 abort된 signal이어도 최소 1회는 실행한 뒤 멈춘다", async () => {
  const container = createCliContainer({ databasePath: ":memory:" });
  const controller = new AbortController();
  controller.abort();
  let sleepCalls = 0;

  const summary = await runWatchLoop(container, {
    intervalMs: 1000,
    signal: controller.signal,
    now: () => new Date("2026-07-20T10:00:00+09:00"),
    sleep: async () => {
      sleepCalls += 1;
    },
  });

  assert.equal(summary.results.length, 1);
  assert.equal(summary.tickCount, 1);
  assert.equal(sleepCalls, 0);
});

test("runWatchLoop은 keepResults:false면 results를 안 쌓고 요약만 정확히 유지한다", async () => {
  const container = createCliContainer({ databasePath: ":memory:" });

  const summary = await runWatchLoop(container, {
    intervalMs: 0,
    maxIterations: 3,
    keepResults: false,
    now: () => new Date("2026-07-20T10:00:00+09:00"),
    sleep: async () => {},
  });

  assert.deepEqual(summary.results, []);
  assert.equal(summary.tickCount, 3);
  assert.ok(summary.totalNotified >= 0);
});

test("runWatchLoop은 tick 하나가 예외를 던져도 다음 tick으로 계속 진행한다", async () => {
  const container = createCliContainer({ databasePath: ":memory:" });
  let calls = 0;
  container.profileRepository = {
    async get() {
      calls += 1;
      if (calls === 1) throw new Error("일시적 오류");
      return undefined;
    },
    async save() {},
  };

  const tickErrors: Array<{ error: unknown; iteration: number }> = [];
  const summary = await runWatchLoop(container, {
    intervalMs: 0,
    maxIterations: 2,
    now: () => new Date("2026-07-20T10:00:00+09:00"),
    sleep: async () => {},
    onTickError: (error, iteration) => tickErrors.push({ error, iteration }),
  });

  assert.equal(summary.tickCount, 2, "실패한 tick도 카운트는 소모해야 함");
  assert.equal(summary.tickErrorCount, 1);
  assert.equal(tickErrors.length, 1);
  assert.equal(tickErrors[0]?.iteration, 1);
  assert.match((tickErrors[0]?.error as Error).message, /일시적 오류/);
  assert.equal(summary.results.length, 1, "성공한 두 번째 tick만 results에 담겨야 함");
});

test("runWatch --once는 즉시 끝나고 tick 진행 상황을 console.log로 찍는다", async () => {
  const container = createCliContainer({ databasePath: ":memory:" });
  const logged = captureConsoleLog();

  let output: string;
  try {
    output = await runWatch(container, ["--once"], new Date("2026-07-20T10:00:00+09:00"));
  } finally {
    logged.restore();
  }

  assert.match(output, /Watch 종료: 1회 실행/);
  assert.ok(logged.lines.some((line) => /\[tick 1\]/.test(line)));
});

test("runWatch는 Source 설정 오류로 수집이 중단되면 tick 전에 경고를 먼저 찍는다(PR #40 리뷰)", async () => {
  const container = createCliContainer({ databasePath: ":memory:" });
  container.sourcesConfigError = "Source 설정 파일이 올바른 JSON이 아닙니다(/tmp/dododo.sources.json)";
  const logged = captureConsoleLog();

  try {
    await runWatch(container, ["--once"], new Date("2026-07-20T10:00:00+09:00"));
  } finally {
    logged.restore();
  }

  assert.ok(logged.lines.length > 0);
  assert.match(logged.lines[0]!, /경고: Source 설정 오류로 수집을 중단합니다/);
});

test("runWatch는 기본값이면 지속 실행하며 SIGINT로 정상 종료한다", async () => {
  const container = createCliContainer({ databasePath: ":memory:" });
  const logged = captureConsoleLog();

  // runWatch 내부는 process.on("SIGINT", ...)를 첫 await 이전(동기 구간)에 등록하므로,
  // 호출 직후 emit해도 리스너가 이미 붙어 있다 — tick 1이 끝난 뒤(파일 읽기 등 여러
  // await를 거치므로 emit보다 한참 뒤) abort 여부를 확인해 정확히 1회만 돌고 멈춘다.
  let output: string;
  try {
    const promise = runWatch(container, []);
    process.emit("SIGINT");
    output = await promise;
  } finally {
    logged.restore();
  }

  assert.match(output, /Watch 종료: 1회 실행/);
  assert.ok(logged.lines.some((line) => /\[tick 1\]/.test(line)));
});

test("runWatch는 알 수 없는 옵션에 사용법을 보여준다", async () => {
  const container = createCliContainer({ databasePath: ":memory:" });
  const output = await runWatch(container, ["--bogus"]);
  assert.match(output, /알 수 없는 옵션입니다: --bogus/);
});

test("runWatch는 잘못된 --interval 값을 거부한다", async () => {
  const container = createCliContainer({ databasePath: ":memory:" });
  const output = await runWatch(container, ["--interval", "0"]);
  assert.match(output, /--interval은 0보다 큰 초 단위 숫자여야 합니다/);
});

test("runWatch는 Node 타이머 한계를 넘는 --interval을 거부한다", async () => {
  const container = createCliContainer({ databasePath: ":memory:" });
  const output = await runWatch(container, ["--interval", "999999999999"]);
  assert.match(output, /--interval은 .*초를 넘을 수 없습니다/);
});

test("runWatch --os-notify는 알 수 없는 옵션으로 처리되지 않는다", async () => {
  // 실제 WindowsOsNotifier.send()가 호출되면 진짜 PowerShell 알림을 띄우려 하므로,
  // 이미 30분 dedup으로 알림이 하나도 안 나가는 두 번째 tick에서만 --os-notify를 써서
  // 플래그 인식만 검증하고 실제 알림 발송 경로는 타지 않게 한다.
  const container = createCliContainer({ databasePath: ":memory:" });
  await runWatch(container, ["--once"]);

  const output = await runWatch(container, ["--once", "--os-notify"]);

  assert.doesNotMatch(output, /알 수 없는 옵션/);
  assert.match(output, /Watch 종료/);
});

test("runWatchTick은 겹치는 Event를 감지하고, 같은 tick 안에서 재알리지 않는다(docs/frontend-plan.md 2.1)", async () => {
  const container = createCliContainer({ databasePath: ":memory:" });
  const now = new Date("2026-07-20T10:00:00+09:00");
  await container.repository.saveContextItems([
    {
      id: "evt-a",
      kind: "event",
      title: "영민이와 복싱 스파링",
      status: "confirmed",
      startAt: "2026-07-25T18:00:00+09:00",
      endAt: "2026-07-25T19:00:00+09:00",
      requirements: [],
      tags: [],
      priority: 0,
      confidence: 1,
      evidenceIds: [],
      metadata: {},
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    },
    {
      id: "evt-b",
      kind: "event",
      title: "춘봉이와 저녁",
      status: "confirmed",
      startAt: "2026-07-25T18:30:00+09:00",
      endAt: "2026-07-25T20:00:00+09:00",
      requirements: [],
      tags: [],
      priority: 0,
      confidence: 1,
      evidenceIds: [],
      metadata: {},
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    },
  ]);

  const first = await runWatchTick(container, now);
  assert.equal(first.newConflicts.length, 1);
  assert.deepEqual([first.newConflicts[0].a.id, first.newConflicts[0].b.id].sort(), ["evt-a", "evt-b"]);

  const second = await runWatchTick(container, now);
  assert.deepEqual(second.newConflicts, []);
});

// doyeonid 리뷰(PR #66) 1·2번 — 아래 세 테스트가 실제로 고쳐진 순서(판정 → gate →
// 전달 → 커밋)를 end-to-end로 검증한다.
test("runWatchTick의 리마인더는 Quiet Hours면 보류되고 발송 완료로 커밋되지 않는다", async () => {
  const container = createCliContainer({ databasePath: ":memory:" });
  container.collectors = []; // Fixture Source의 일반 추천과 섞이지 않게 한다
  const now = new Date("2026-07-20T10:00:00+09:00");
  await container.repository.saveContextItems([taskDueSoon("t1", now)]);
  await container.profileRepository.save({ ...emptyProfile(), quietHours: { start: "00:00", end: "23:59" } });

  const result = await runWatchTick(container, now);

  const reminderResults = [...result.notified, ...result.heldForQuietHours].filter(
    (r) => isReminderRecommendationId(r.id),
  );
  assert.equal(reminderResults.length, 1);
  assert.equal(result.notified.some((r) => isReminderRecommendationId(r.id)), false, "Quiet Hours 중엔 전달되면 안 됨");

  const item = await container.repository.findContextItem("t1");
  assert.equal(item?.metadata.reminderSentForDeadline, undefined, "보류된 리마인더는 발송 완료로 커밋되면 안 됨");
});

test("runWatchTick의 충돌은 Quiet Hours가 끝날 때까지 알림 완료로 커밋하지 않는다", async () => {
  const container = createCliContainer({ databasePath: ":memory:" });
  container.collectors = [];
  const quietNow = new Date("2026-07-20T10:00:00+09:00");
  await container.repository.saveContextItems([
    scheduledEvent("evt-a", "2026-07-20T11:00:00+09:00", "2026-07-20T12:00:00+09:00"),
    scheduledEvent("evt-b", "2026-07-20T11:30:00+09:00", "2026-07-20T12:30:00+09:00"),
  ]);
  await container.profileRepository.save({ ...emptyProfile(), quietHours: { start: "00:00", end: "23:59" } });

  const held = await runWatchTick(container, quietNow);
  assert.equal(held.withinQuietHours, true);
  assert.equal(held.newConflicts.length, 1);

  await container.profileRepository.save(emptyProfile());
  const delivered = await runWatchTick(container, new Date("2026-07-20T10:05:00+09:00"));
  assert.equal(delivered.withinQuietHours, false);
  assert.equal(delivered.newConflicts.length, 1, "Quiet Hours 종료 후 같은 충돌을 다시 전달해야 함");
});

test("runWatchTick의 리마인더는 Quiet Hours가 끝나면 다음 tick에 실제로 전달된다", async () => {
  const container = createCliContainer({ databasePath: ":memory:" });
  container.collectors = [];
  const quietNow = new Date("2026-07-20T10:00:00+09:00");
  await container.repository.saveContextItems([taskDueSoon("t1", quietNow)]);
  await container.profileRepository.save({ ...emptyProfile(), quietHours: { start: "00:00", end: "23:59" } });
  const notifier = new RecordingNotifier();
  container.notifier = notifier;

  await runWatchTick(container, quietNow);
  assert.equal(notifier.sent.length, 0);

  await container.profileRepository.save({ ...emptyProfile() }); // Quiet Hours 해제
  const laterNow = new Date("2026-07-20T10:05:00+09:00");
  const result = await runWatchTick(container, laterNow);

  assert.equal(result.notified.filter((r) => isReminderRecommendationId(r.id)).length, 1);
  assert.equal(notifier.sent.some((r) => isReminderRecommendationId(r.id)), true);

  const item = await container.repository.findContextItem("t1");
  assert.equal(item?.metadata.reminderSentForDeadline, taskDueSoon("t1", quietNow).deadline);
});

test("runWatchTick은 리마인더 전달이 실패하면 발송 완료로 커밋하지 않는다(doyeonid 리뷰 PR #66)", async () => {
  const container = createCliContainer({ databasePath: ":memory:" });
  container.collectors = [];
  const now = new Date("2026-07-20T10:00:00+09:00");
  await container.repository.saveContextItems([taskDueSoon("t1", now)]);
  container.notifier = new FailingReminderNotifier();

  await assert.rejects(runWatchTick(container, now), /리마인더 전달 실패/);

  const item = await container.repository.findContextItem("t1");
  assert.equal(item?.metadata.reminderSentForDeadline, undefined);
});
