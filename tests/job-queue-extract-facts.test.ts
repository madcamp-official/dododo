import assert from "node:assert/strict";
import test from "node:test";

import { ContextPipeline } from "../packages/context-engine/src/index.ts";
import { InMemoryContextRepository, InMemoryRawItemRepository } from "../packages/storage/src/index.ts";
import type { ContextItem, Fact, RawItem } from "../packages/shared/src/index.ts";
import { createExtractFactsJobHandler } from "../apps/cli/src/runtime/jobQueue/extractFactsJob.ts";

const RAW_ITEM: RawItem = {
  id: "raw-1",
  sourceId: "lms-main",
  sourceType: "lms",
  externalId: "assignment-1",
  uri: "https://lms.example/assignments/1",
  title: "과제 1",
  content: "마감: 다음 주 금요일",
  contentHash: "hash-v1",
  observedAt: "2026-07-22T09:00:00Z",
  metadata: {},
};

function passthroughPrivacyGateway() {
  return { prepare: async (item: RawItem) => item };
}

test("RawItem을 찾으면 pipeline.sync로 재추출하고 성공하면 아무 것도 던지지 않는다", async () => {
  const rawItemRepository = new InMemoryRawItemRepository();
  await rawItemRepository.save(RAW_ITEM);

  const pipeline = new ContextPipeline({
    repository: new InMemoryContextRepository(),
    privacyGateway: passthroughPrivacyGateway(),
    factExtractor: {
      extract: async (item): Promise<Fact[]> => [{
        id: `fact-${item.id}`,
        rawItemId: item.id,
        kind: "deadline",
        subject: item.title ?? "",
        value: "다음 주 금요일",
        confidence: 0.9,
        evidenceText: item.content,
      }],
    },
    contextResolver: {
      resolve: async (): Promise<ContextItem[]> => [],
    },
  });

  const handler = createExtractFactsJobHandler({ rawItemRepository, pipeline });
  await assert.doesNotReject(() => handler("raw-1", new Date()));
});

test("RawItem이 없으면(삭제 등) 조용히 성공 처리한다(재처리 대상 없음)", async () => {
  const rawItemRepository = new InMemoryRawItemRepository();
  const pipeline = new ContextPipeline({
    repository: new InMemoryContextRepository(),
    privacyGateway: passthroughPrivacyGateway(),
    factExtractor: { extract: async () => { throw new Error("호출되면 안 됨"); } },
    contextResolver: { resolve: async () => [] },
  });

  const handler = createExtractFactsJobHandler({ rawItemRepository, pipeline });
  await assert.doesNotReject(() => handler("없는-id", new Date()));
});

test("추출이 실패하면(pipeline.sync가 errors를 반환) 그 메시지로 던진다 — Worker가 재시도/dead-letter 판단에 쓴다", async () => {
  const rawItemRepository = new InMemoryRawItemRepository();
  await rawItemRepository.save(RAW_ITEM);

  const pipeline = new ContextPipeline({
    repository: new InMemoryContextRepository(),
    privacyGateway: passthroughPrivacyGateway(),
    factExtractor: {
      extract: async () => {
        throw new Error("일시적 LLM 오류");
      },
    },
    contextResolver: { resolve: async () => [] },
  });

  const handler = createExtractFactsJobHandler({ rawItemRepository, pipeline });
  await assert.rejects(() => handler("raw-1", new Date()), /일시적 LLM 오류/);
});
