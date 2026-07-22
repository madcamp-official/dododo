import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { openRawItemDatabase, SQLiteJobQueueRepository } from "../packages/storage/src/index.ts";
import type { JobQueueRepository } from "../packages/shared/src/index.ts";

function createRepository(): JobQueueRepository {
  return new SQLiteJobQueueRepository(openRawItemDatabase());
}

const NOW = new Date("2026-07-22T10:00:00Z");

test("SQLite: enqueue한 작업을 claimNext로 뽑으면 leased 상태가 되고 leaseUntil이 설정된다", async () => {
  const queue = createRepository();
  await queue.enqueue({ id: "extract_facts:raw-1", type: "extract_facts", inputRef: "raw-1", now: NOW });

  const claimed = await queue.claimNext(["extract_facts"], NOW, 60_000);
  assert.equal(claimed?.id, "extract_facts:raw-1");
  assert.equal(claimed?.inputRef, "raw-1");
  assert.equal(claimed?.status, "leased");
  assert.equal(claimed?.attempts, 0);
  assert.equal(claimed?.leaseUntil, new Date(NOW.getTime() + 60_000).toISOString());
});

test("SQLite: 같은 id를 pending 상태에서 다시 enqueue해도 중복되지 않는다(멱등)", async () => {
  const queue = createRepository();
  await queue.enqueue({ id: "extract_facts:raw-1", type: "extract_facts", inputRef: "raw-1", now: NOW });
  await queue.enqueue({ id: "extract_facts:raw-1", type: "extract_facts", inputRef: "raw-1", now: NOW });

  const first = await queue.claimNext(["extract_facts"], NOW, 60_000);
  assert.notEqual(first, undefined);
  const second = await queue.claimNext(["extract_facts"], NOW, 60_000);
  assert.equal(second, undefined);
});

test("SQLite: nextRunAt이 아직 안 됐으면 claimNext가 뽑지 않는다", async () => {
  const queue = createRepository();
  await queue.enqueue({ id: "extract_facts:raw-1", type: "extract_facts", inputRef: "raw-1", now: NOW });
  const claimed = await queue.claimNext(["extract_facts"], NOW, 60_000);
  assert.notEqual(claimed, undefined);
  await queue.retry(claimed!.id, claimed!.leaseToken!, NOW, new Date(NOW.getTime() + 5 * 60_000), "일시적 오류");

  const tooEarly = await queue.claimNext(["extract_facts"], NOW, 60_000);
  assert.equal(tooEarly, undefined);

  const dueLater = await queue.claimNext(["extract_facts"], new Date(NOW.getTime() + 5 * 60_000 + 1), 60_000);
  assert.notEqual(dueLater, undefined);
});

test("SQLite: claimNext는 지정한 type만 뽑는다", async () => {
  const queue = createRepository();
  await queue.enqueue({ id: "generate_advice:x", type: "generate_advice", inputRef: "x", now: NOW });

  const claimed = await queue.claimNext(["extract_facts"], NOW, 60_000);
  assert.equal(claimed, undefined);

  const claimedRight = await queue.claimNext(["generate_advice"], NOW, 60_000);
  assert.notEqual(claimedRight, undefined);
});

test("SQLite: claimNext는 priority가 높은 작업을 먼저 뽑는다", async () => {
  const queue = createRepository();
  await queue.enqueue({ id: "job-low", type: "extract_facts", inputRef: "low", priority: 0, now: NOW });
  await queue.enqueue({ id: "job-high", type: "extract_facts", inputRef: "high", priority: 10, now: NOW });

  const claimed = await queue.claimNext(["extract_facts"], NOW, 60_000);
  assert.equal(claimed?.id, "job-high");
});

test("SQLite: retry는 attempts를 늘리고 pending으로 되돌린다", async () => {
  const queue = createRepository();
  await queue.enqueue({ id: "extract_facts:raw-1", type: "extract_facts", inputRef: "raw-1", now: NOW });
  const claimed = await queue.claimNext(["extract_facts"], NOW, 60_000);

  await queue.retry(claimed!.id, claimed!.leaseToken!, NOW, NOW, "일시적 오류");

  const reclaimed = await queue.claimNext(["extract_facts"], NOW, 60_000);
  assert.equal(reclaimed?.attempts, 1);
  assert.equal(reclaimed?.lastError, "일시적 오류");
});

test("SQLite: complete 이후에는 다시 claim되지 않는다", async () => {
  const queue = createRepository();
  await queue.enqueue({ id: "extract_facts:raw-1", type: "extract_facts", inputRef: "raw-1", now: NOW });
  const claimed = await queue.claimNext(["extract_facts"], NOW, 60_000);
  await queue.complete(claimed!.id, claimed!.leaseToken!, NOW);

  const reclaimed = await queue.claimNext(["extract_facts"], NOW, 60_000);
  assert.equal(reclaimed, undefined);
});

test("SQLite: deadLetter로 보낸 작업은 listDeadLetters에 나오고 다시 claim되지 않는다", async () => {
  const queue = createRepository();
  await queue.enqueue({ id: "extract_facts:raw-1", type: "extract_facts", inputRef: "raw-1", now: NOW });
  const claimed = await queue.claimNext(["extract_facts"], NOW, 60_000);
  await queue.deadLetter(claimed!.id, claimed!.leaseToken!, NOW, "영구 실패");

  const reclaimed = await queue.claimNext(["extract_facts"], NOW, 60_000);
  assert.equal(reclaimed, undefined);

  const deadLetters = await queue.listDeadLetters();
  assert.equal(deadLetters.length, 1);
  assert.equal(deadLetters[0]?.id, "extract_facts:raw-1");
  assert.equal(deadLetters[0]?.lastError, "영구 실패");
});

test("SQLite: recoverExpiredLeases는 leaseUntil이 지난 leased 작업만 pending으로 되돌린다", async () => {
  const queue = createRepository();
  await queue.enqueue({ id: "expired", type: "extract_facts", inputRef: "a", now: NOW });
  await queue.enqueue({ id: "still-leased", type: "extract_facts", inputRef: "b", now: NOW });

  await queue.claimNext(["extract_facts"], NOW, 1_000);
  await queue.claimNext(["extract_facts"], NOW, 10 * 60_000);

  const laterNow = new Date(NOW.getTime() + 5_000);
  const recovered = await queue.recoverExpiredLeases(laterNow);
  assert.equal(recovered, 1);

  const reclaimed = await queue.claimNext(["extract_facts"], laterNow, 60_000);
  assert.equal(reclaimed?.id, "expired");
  assert.equal(reclaimed?.attempts, 0);
});

// doyeonid 리뷰(PR #100) P1: 같은 SQLite 파일을 여는 서로 다른 연결 두 개(watch/CLI/
// Electron이 각자 자기 연결로 큐를 씀)가 동시에 claimNext를 불러도, 원자적 UPDATE
// (subquery + status='pending' 재확인)가 SQLite의 쓰기 직렬화 덕분에 같은 Job을
// 중복으로 넘겨주지 않는다.
test("SQLite: 만료된 lease로 재획득된 Job은 원래 Worker의 뒤늦은 complete로 덮어써지지 않는다", async () => {
  const queue = createRepository();
  await queue.enqueue({ id: "extract_facts:raw-1", type: "extract_facts", inputRef: "raw-1", now: NOW });

  const staleClaim = await queue.claimNext(["extract_facts"], NOW, 1_000);
  assert.notEqual(staleClaim, undefined);

  const later = new Date(NOW.getTime() + 5_000);
  await queue.recoverExpiredLeases(later);
  const newClaim = await queue.claimNext(["extract_facts"], later, 60_000);
  assert.notEqual(newClaim, undefined);
  assert.notEqual(newClaim!.leaseToken, staleClaim!.leaseToken);

  await queue.complete(staleClaim!.id, staleClaim!.leaseToken!, later);

  const stillLeased = await queue.claimNext(["extract_facts"], later, 60_000);
  assert.equal(stillLeased, undefined, "이미 leased 상태라 다시 claim되면 안 됨");

  await queue.complete(newClaim!.id, newClaim!.leaseToken!, later);
  assert.deepEqual(await queue.listDeadLetters(), []);
});

test("SQLite: 서로 다른 연결 두 개가 동시에 claimNext해도 같은 Job을 중복으로 넘기지 않는다", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "dododo-job-queue-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const dbPath = join(directory, "jobs.db");

  const connectionA = openRawItemDatabase(dbPath);
  const connectionB = openRawItemDatabase(dbPath);
  const queueA = new SQLiteJobQueueRepository(connectionA);
  const queueB = new SQLiteJobQueueRepository(connectionB);

  try {
    await queueA.enqueue({ id: "extract_facts:raw-1", type: "extract_facts", inputRef: "raw-1", now: NOW });

    const [claimedA, claimedB] = await Promise.all([
      queueA.claimNext(["extract_facts"], NOW, 60_000),
      queueB.claimNext(["extract_facts"], NOW, 60_000),
    ]);

    // 딱 하나의 연결만 claim에 성공해야 한다(중복 claim이면 둘 다 정의돼 있을 것).
    const claims = [claimedA, claimedB].filter((job) => job !== undefined);
    assert.equal(claims.length, 1);
  } finally {
    // 디렉터리 삭제(t.after) 전에 두 연결을 먼저 확실히 닫는다 — Windows에서 파일
    // 핸들이 열려 있으면 rm이 EBUSY로 실패한다.
    connectionA.close();
    connectionB.close();
  }
});

test("SQLite: done/dead_letter로 끝난 뒤 같은 id로 다시 enqueue하면 새 작업으로 취급한다", async () => {
  const queue = createRepository();
  await queue.enqueue({ id: "extract_facts:raw-1", type: "extract_facts", inputRef: "raw-1", now: NOW });
  const claimed = await queue.claimNext(["extract_facts"], NOW, 60_000);
  await queue.deadLetter(claimed!.id, claimed!.leaseToken!, NOW, "영구 실패");

  await queue.enqueue({ id: "extract_facts:raw-1", type: "extract_facts", inputRef: "raw-1", now: NOW });
  const reclaimed = await queue.claimNext(["extract_facts"], NOW, 60_000);
  assert.equal(reclaimed?.attempts, 0);
  assert.equal(reclaimed?.status, "leased");
});
