import assert from "node:assert/strict";
import test from "node:test";

import { syncIncrementally } from "../apps/cli/src/runtime/incrementalSync.ts";
import { ContextPipeline, DeterministicContextResolver } from "../packages/context-engine/src/index.ts";
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
