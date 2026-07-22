import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryJobQueueRepository } from "../packages/storage/src/index.ts";
import type { JobQueueRepository } from "../packages/shared/src/index.ts";

function createRepository(): JobQueueRepository {
  return new InMemoryJobQueueRepository();
}

const NOW = new Date("2026-07-22T10:00:00Z");

test("enqueue한 작업을 claimNext로 뽑으면 leased 상태가 되고 leaseUntil이 설정된다", async () => {
  const queue = createRepository();
  await queue.enqueue({ id: "extract_facts:raw-1", type: "extract_facts", inputRef: "raw-1", now: NOW });

  const claimed = await queue.claimNext(["extract_facts"], NOW, 60_000);
  assert.equal(claimed?.id, "extract_facts:raw-1");
  assert.equal(claimed?.inputRef, "raw-1");
  assert.equal(claimed?.status, "leased");
  assert.equal(claimed?.attempts, 0);
  assert.equal(claimed?.leaseUntil, new Date(NOW.getTime() + 60_000).toISOString());
});

test("같은 id를 pending 상태에서 다시 enqueue해도 중복되지 않는다(멱등)", async () => {
  const queue = createRepository();
  await queue.enqueue({ id: "extract_facts:raw-1", type: "extract_facts", inputRef: "raw-1", now: NOW });
  await queue.enqueue({ id: "extract_facts:raw-1", type: "extract_facts", inputRef: "raw-1", now: NOW });

  const first = await queue.claimNext(["extract_facts"], NOW, 60_000);
  assert.notEqual(first, undefined);
  const second = await queue.claimNext(["extract_facts"], NOW, 60_000);
  assert.equal(second, undefined);
});

test("nextRunAt이 아직 안 됐으면 claimNext가 뽑지 않는다", async () => {
  const queue = createRepository();
  await queue.enqueue({ id: "extract_facts:raw-1", type: "extract_facts", inputRef: "raw-1", now: NOW });
  // retry로 미래 시각으로 미뤄둔다.
  const claimed = await queue.claimNext(["extract_facts"], NOW, 60_000);
  assert.notEqual(claimed, undefined);
  await queue.retry(claimed!.id, claimed!.leaseToken!, NOW, new Date(NOW.getTime() + 5 * 60_000), "일시적 오류");

  const tooEarly = await queue.claimNext(["extract_facts"], NOW, 60_000);
  assert.equal(tooEarly, undefined);

  const dueLater = await queue.claimNext(["extract_facts"], new Date(NOW.getTime() + 5 * 60_000 + 1), 60_000);
  assert.notEqual(dueLater, undefined);
});

test("claimNext는 지정한 type만 뽑는다", async () => {
  const queue = createRepository();
  await queue.enqueue({ id: "generate_advice:x", type: "generate_advice", inputRef: "x", now: NOW });

  const claimed = await queue.claimNext(["extract_facts"], NOW, 60_000);
  assert.equal(claimed, undefined);

  const claimedRight = await queue.claimNext(["generate_advice"], NOW, 60_000);
  assert.notEqual(claimedRight, undefined);
});

test("claimNext는 priority가 높은 작업을 먼저 뽑는다", async () => {
  const queue = createRepository();
  await queue.enqueue({ id: "job-low", type: "extract_facts", inputRef: "low", priority: 0, now: NOW });
  await queue.enqueue({ id: "job-high", type: "extract_facts", inputRef: "high", priority: 10, now: NOW });

  const claimed = await queue.claimNext(["extract_facts"], NOW, 60_000);
  assert.equal(claimed?.id, "job-high");
});

test("retry는 attempts를 늘리고 pending으로 되돌린다", async () => {
  const queue = createRepository();
  await queue.enqueue({ id: "extract_facts:raw-1", type: "extract_facts", inputRef: "raw-1", now: NOW });
  const claimed = await queue.claimNext(["extract_facts"], NOW, 60_000);

  await queue.retry(claimed!.id, claimed!.leaseToken!, NOW, NOW, "일시적 오류");

  const reclaimed = await queue.claimNext(["extract_facts"], NOW, 60_000);
  assert.equal(reclaimed?.attempts, 1);
  assert.equal(reclaimed?.lastError, "일시적 오류");
});

test("complete 이후에는 다시 claim되지 않는다", async () => {
  const queue = createRepository();
  await queue.enqueue({ id: "extract_facts:raw-1", type: "extract_facts", inputRef: "raw-1", now: NOW });
  const claimed = await queue.claimNext(["extract_facts"], NOW, 60_000);
  await queue.complete(claimed!.id, claimed!.leaseToken!, NOW);

  const reclaimed = await queue.claimNext(["extract_facts"], NOW, 60_000);
  assert.equal(reclaimed, undefined);
});

test("deadLetter로 보낸 작업은 listDeadLetters에 나오고 다시 claim되지 않는다", async () => {
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

test("recoverExpiredLeases는 leaseUntil이 지난 leased 작업만 pending으로 되돌린다", async () => {
  const queue = createRepository();
  await queue.enqueue({ id: "expired", type: "extract_facts", inputRef: "a", now: NOW });
  await queue.enqueue({ id: "still-leased", type: "extract_facts", inputRef: "b", now: NOW });

  await queue.claimNext(["extract_facts"], NOW, 1_000); // expired: 1초 뒤 만료
  await queue.claimNext(["extract_facts"], NOW, 10 * 60_000); // still-leased: 10분 뒤 만료

  const laterNow = new Date(NOW.getTime() + 5_000); // 5초 후 — expired만 만료됨
  const recovered = await queue.recoverExpiredLeases(laterNow);
  assert.equal(recovered, 1);

  const reclaimed = await queue.claimNext(["extract_facts"], laterNow, 60_000);
  assert.equal(reclaimed?.id, "expired");
  assert.equal(reclaimed?.attempts, 0); // 복구는 재시도 횟수를 늘리지 않는다(Worker가 죽었을 뿐 job 잘못이 아님)
});

// doyeonid 리뷰(PR #100) P1: lease가 만료돼 다른 Worker가 같은 Job을 재획득한 뒤,
// 원래(느린) Worker가 뒤늦게 옛 결과로 complete/retry/deadLetter를 호출해도 새
// Worker의 처리 상태를 덮어쓰면 안 된다 — leaseToken이 안 맞으면 조용히 무시된다.
test("만료된 lease로 재획득된 Job은 원래 Worker의 뒤늦은 complete로 덮어써지지 않는다", async () => {
  const queue = createRepository();
  await queue.enqueue({ id: "extract_facts:raw-1", type: "extract_facts", inputRef: "raw-1", now: NOW });

  const staleClaim = await queue.claimNext(["extract_facts"], NOW, 1_000); // 1초 뒤 만료
  assert.notEqual(staleClaim, undefined);

  const later = new Date(NOW.getTime() + 5_000);
  await queue.recoverExpiredLeases(later); // 죽은 Worker로 간주해 pending으로 복구
  const newClaim = await queue.claimNext(["extract_facts"], later, 60_000);
  assert.notEqual(newClaim, undefined);
  assert.notEqual(newClaim!.leaseToken, staleClaim!.leaseToken); // 새 lease는 다른 토큰

  // 원래(느린) Worker가 이제야 옛 토큰으로 완료를 시도한다 — 무시돼야 한다.
  await queue.complete(staleClaim!.id, staleClaim!.leaseToken!, later);

  // 새 Worker의 claim은 여전히 leased 상태를 유지한다(완료되지 않음).
  const stillLeased = await queue.claimNext(["extract_facts"], later, 60_000);
  assert.equal(stillLeased, undefined, "이미 leased 상태라 다시 claim되면 안 됨");

  // 새 Worker가 정당한 토큰으로 완료하면 정상 반영된다.
  await queue.complete(newClaim!.id, newClaim!.leaseToken!, later);
  const deadLetters = await queue.listDeadLetters();
  assert.deepEqual(deadLetters, []);
});

test("done/dead_letter로 끝난 뒤 같은 id로 다시 enqueue하면 새 작업으로 취급한다", async () => {
  const queue = createRepository();
  await queue.enqueue({ id: "extract_facts:raw-1", type: "extract_facts", inputRef: "raw-1", now: NOW });
  const claimed = await queue.claimNext(["extract_facts"], NOW, 60_000);
  await queue.deadLetter(claimed!.id, claimed!.leaseToken!, NOW, "영구 실패");

  await queue.enqueue({ id: "extract_facts:raw-1", type: "extract_facts", inputRef: "raw-1", now: NOW });
  const reclaimed = await queue.claimNext(["extract_facts"], NOW, 60_000);
  assert.equal(reclaimed?.attempts, 0);
  assert.equal(reclaimed?.status, "leased");
});
