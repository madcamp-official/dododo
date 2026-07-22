import assert from "node:assert/strict";
import test from "node:test";

import { syncIncrementally } from "../apps/cli/src/runtime/incrementalSync.ts";
import { InMemoryJobQueueRepository } from "../packages/storage/src/index.ts";
import { RetryAwareFactExtractor } from "../apps/cli/src/runtime/retryAwareFactExtractor.ts";
import {
  ContextPipeline,
  DeterministicContextResolver,
  LLMExtractionError,
  LLMFactExtractor,
  type LLMJSONRequest,
  type LLMProvider,
} from "../packages/context-engine/src/index.ts";
import { InMemoryContextRepository, InMemoryRawItemRepository } from "../packages/storage/src/index.ts";
import type { Collector, FactExtractor, PrivacyGateway, RawItem } from "../packages/shared/src/index.ts";

function fixedCollector(item: RawItem): Collector {
  return {
    sourceId: item.sourceId,
    sourceType: item.sourceType,
    async sync() {
      return [item];
    },
  };
}

// 처음 N번은 실패하고 이후엔 성공하는 PrivacyGateway — "일시적 오류" 재현용.
class FlakyPrivacyGateway implements PrivacyGateway {
  private readonly failTimes: number;
  private callCount = 0;

  constructor(failTimes: number) {
    this.failTimes = failTimes;
  }

  async prepare(rawItem: RawItem): Promise<RawItem> {
    this.callCount += 1;
    if (this.callCount <= this.failTimes) throw new Error("일시적 오류");
    return rawItem;
  }
}

const NOOP_FACT_EXTRACTOR: FactExtractor = {
  async extract() {
    return [];
  },
};

function sampleRawItem(): RawItem {
  return {
    id: "raw-1",
    sourceId: "src",
    sourceType: "lms",
    uri: "https://example.com/1",
    content: "본문",
    contentHash: "hash-1",
    observedAt: "2026-07-20T00:00:00+09:00",
    metadata: {},
  };
}

test("syncIncrementally는 pipeline 실패 시 커밋하지 않아 다음 호출에서 재시도한다", async () => {
  const rawItemRepository = new InMemoryRawItemRepository();
  const pipeline = new ContextPipeline({
    repository: new InMemoryContextRepository(),
    privacyGateway: new FlakyPrivacyGateway(1),
    factExtractor: NOOP_FACT_EXTRACTOR,
    contextResolver: new DeterministicContextResolver(),
  });
  const item = sampleRawItem();
  const collector = fixedCollector(item);

  const first = await syncIncrementally(collector, pipeline, rawItemRepository);
  assert.ok(first.errors.length > 0, "첫 호출은 실패해야 함");
  assert.equal(await rawItemRepository.findByUri(item.sourceId, item.uri), undefined, "실패했으니 커밋되면 안 됨");

  const second = await syncIncrementally(collector, pipeline, rawItemRepository);
  assert.deepEqual(second.errors, [], "같은 항목이 재시도돼 이번엔 성공해야 함");

  const third = await syncIncrementally(collector, pipeline, rawItemRepository);
  assert.equal(third.skipped, 1, "성공 후 커밋됐으니 세 번째 호출은 변경 없음으로 건너뛰어야 함");
  assert.equal(third.collected, 0);
});

// 처음 N번은 재시도 가능한 오류(예: 연결 실패)를 던지고 이후엔 정상 응답하는 fake Provider —
// "일시적 LLM 장애 → 복구" 재현용(PR #33 리뷰, doyeonid 지적).
class FlakyLLMProvider implements LLMProvider {
  private readonly failTimes: number;
  private callCount = 0;

  constructor(failTimes: number) {
    this.failTimes = failTimes;
  }

  async completeJSON<T>(request: LLMJSONRequest<T>): Promise<T> {
    this.callCount += 1;
    if (this.callCount <= this.failTimes) {
      throw new LLMExtractionError("connect ECONNREFUSED", { category: "connection" });
    }
    const value = { facts: [] };
    if (!request.validate(value)) throw new Error("unexpected: facts:[] should validate");
    return value;
  }
}

test("일시적 LLM 실패는 커밋되지 않고, Provider가 복구되면 같은 RawItem이 재시도돼 성공한다", async () => {
  const rawItemRepository = new InMemoryRawItemRepository();
  const flakyProvider = new FlakyLLMProvider(1);
  const pipeline = new ContextPipeline({
    repository: new InMemoryContextRepository(),
    privacyGateway: { async prepare(rawItem: RawItem) { return rawItem; } },
    factExtractor: new RetryAwareFactExtractor(new LLMFactExtractor(flakyProvider)),
    contextResolver: new DeterministicContextResolver(),
  });
  const item = sampleRawItem();
  const collector = fixedCollector(item);

  const first = await syncIncrementally(collector, pipeline, rawItemRepository);
  assert.ok(first.errors.length > 0, "첫 동기화는 일시적 LLM 오류로 실패해야 함");
  assert.equal(
    await rawItemRepository.findByUri(item.sourceId, item.uri),
    undefined,
    "재시도 가능한 실패는 체크포인트에 저장되면 안 됨(다음 tick에 스킵되지 않아야 함)",
  );

  const second = await syncIncrementally(collector, pipeline, rawItemRepository);
  assert.deepEqual(second.errors, [], "Provider가 복구됐으니 두 번째 동기화는 성공해야 함");
});

test("syncIncrementally는 변경 없으면 collector.sync()로 값은 받아오되 pipeline은 안 부른다", async () => {
  const rawItemRepository = new InMemoryRawItemRepository();
  let prepareCalls = 0;
  const pipeline = new ContextPipeline({
    repository: new InMemoryContextRepository(),
    privacyGateway: {
      async prepare(rawItem: RawItem) {
        prepareCalls += 1;
        return rawItem;
      },
    },
    factExtractor: NOOP_FACT_EXTRACTOR,
    contextResolver: new DeterministicContextResolver(),
  });
  const item = sampleRawItem();
  const collector = fixedCollector(item);

  await syncIncrementally(collector, pipeline, rawItemRepository);
  assert.equal(prepareCalls, 1);

  await syncIncrementally(collector, pipeline, rawItemRepository);
  assert.equal(prepareCalls, 1, "변경 없는 두 번째 호출은 privacyGateway를 다시 부르면 안 됨");
});

test("jobQueue가 주어지면 배치 실패 시에도 RawItem을 저장하고 extract_facts Job을 enqueue한다", async () => {
  const rawItemRepository = new InMemoryRawItemRepository();
  const jobQueue = new InMemoryJobQueueRepository();
  // 항상 실패하는 게이트웨이 — Job Queue로 재시도를 넘기는 경로만 확인한다.
  const pipeline = new ContextPipeline({
    repository: new InMemoryContextRepository(),
    privacyGateway: new FlakyPrivacyGateway(Number.POSITIVE_INFINITY),
    factExtractor: NOOP_FACT_EXTRACTOR,
    contextResolver: new DeterministicContextResolver(),
  });
  const item = sampleRawItem();
  const collector = fixedCollector(item);
  const now = new Date("2026-07-22T10:00:00Z");

  const result = await syncIncrementally(collector, pipeline, rawItemRepository, { jobQueue, now });

  assert.ok(result.errors.length > 0);
  // jobQueue가 없을 때(위 첫 테스트)와 달리, 관찰 자체는 저장돼 다음 tick에
  // "안 바뀜"으로 걸러진다 — 무한 재시도 대신 Job Queue가 재시도를 맡는다.
  assert.notEqual(await rawItemRepository.findByUri(item.sourceId, item.uri), undefined);

  const claimed = await jobQueue.claimNext(["extract_facts"], now, 60_000);
  assert.equal(claimed?.id, `extract_facts:${item.id}`);
  assert.equal(claimed?.inputRef, item.id);
});

test("jobQueue가 주어져도 성공한 배치는 기존과 동일하게 동작한다(Job을 만들지 않음)", async () => {
  const rawItemRepository = new InMemoryRawItemRepository();
  const jobQueue = new InMemoryJobQueueRepository();
  const pipeline = new ContextPipeline({
    repository: new InMemoryContextRepository(),
    privacyGateway: { async prepare(rawItem: RawItem) { return rawItem; } },
    factExtractor: NOOP_FACT_EXTRACTOR,
    contextResolver: new DeterministicContextResolver(),
  });
  const item = sampleRawItem();
  const collector = fixedCollector(item);
  const now = new Date("2026-07-22T10:00:00Z");

  const result = await syncIncrementally(collector, pipeline, rawItemRepository, { jobQueue, now });

  assert.deepEqual(result.errors, []);
  assert.equal(await jobQueue.claimNext(["extract_facts"], now, 60_000), undefined);
});

test("Collector 부분 오류는 정상 RawItem을 저장하면서 SyncResult에 보존한다", async () => {
  const rawItemRepository = new InMemoryRawItemRepository();
  const pipeline = new ContextPipeline({
    repository: new InMemoryContextRepository(),
    privacyGateway: { async prepare(rawItem: RawItem) { return rawItem; } },
    factExtractor: NOOP_FACT_EXTRACTOR,
    contextResolver: new DeterministicContextResolver(),
  });
  const item = sampleRawItem();
  const collector: Collector & { listErrors(): Array<{ sourceUri: string; message: string }> } = {
    ...fixedCollector(item),
    listErrors: () => [{ sourceUri: "fixture://invalid", message: "일부 문서 오류" }],
  };

  const result = await syncIncrementally(collector, pipeline, rawItemRepository);

  assert.match(result.errors[0] ?? "", /fixture:\/\/invalid: 일부 문서 오류/);
  assert.notEqual(await rawItemRepository.findByUri(item.sourceId, item.uri), undefined);
});
