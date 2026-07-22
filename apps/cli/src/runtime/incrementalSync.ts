import type {
  Collector,
  JobQueueRepository,
  RawItem,
  SourceType,
  SyncResult,
} from "../../../../packages/shared/src/index.ts";
import type { ContextPipeline } from "../../../../packages/context-engine/src/index.ts";
import { readCollectorDiagnostics } from "../../../../packages/collectors/src/index.ts";
import type { RawItemRepository } from "../../../../packages/storage/src/index.ts";

// pipeline.sync(collector)가 반환한 RawItem을 전부(스킵 없이) 다시 Fact 추출·
// resolve하므로(packages/context-engine, Intelligence 소유 — 여기서 안 고침),
// 변경 없는 RawItem까지 매 tick 재분석되지 않도록 미리 걸러서 넘긴다.
//
// 핵심 규칙: 판정(created/updated/skipped)만 먼저 하고, 실제 커밋(RawItemRepository.save)은
// pipeline 처리가 전부 성공한 뒤에만 한다. 커밋을 먼저 해버리면(예전 구현의 버그) Privacy/
// Fact/Resolver 단계가 일시적으로 실패해도 다음 tick엔 "안 바뀜"으로 보여 그 RawItem이
// 영영 재시도되지 않는다(팀 리뷰 지적). 판정 단계는 findBy*(조회 전용, 부작용 없음)만 쓴다.
class FixedItemsCollector implements Collector {
  readonly sourceId: string;
  readonly sourceType: SourceType;
  private readonly items: RawItem[];

  constructor(source: Collector, items: RawItem[]) {
    this.sourceId = source.sourceId;
    this.sourceType = source.sourceType;
    this.items = items;
  }

  async sync(): Promise<RawItem[]> {
    return this.items;
  }
}

export interface SyncIncrementallyOptions {
  // docs/llm-architecture.md §5의 Job Queue. 주어지면(선택 사항 — 기존 호출부·테스트는
  // 안 넘겨도 동작이 그대로다) 배치 실패 시 재시도·Backoff·Dead Letter가 있는 큐로
  // 넘긴다. 안 주어지면 기존처럼 배치 전체를 커밋하지 않고 다음 tick에 통째로 다시
  // 시도한다(무한 재시도, Backoff 없음 — 지금까지의 기존 동작 그대로).
  jobQueue?: JobQueueRepository;
  now?: Date;
}

export async function syncIncrementally(
  collector: Collector,
  pipeline: ContextPipeline,
  rawItemRepository: RawItemRepository,
  options: SyncIncrementallyOptions = {},
): Promise<SyncResult> {
  let rawItems: RawItem[];
  let changed: RawItem[];
  let diagnostics: string[];
  try {
    rawItems = await collector.sync();
    diagnostics = readCollectorDiagnostics(collector).map((error) => error.sourceUri === undefined
      ? error.message
      : `${error.sourceUri}: ${error.message}`);
    changed = await filterChanged(rawItems, rawItemRepository);
  } catch (error) {
    // 판정 단계 자체가 실패해도(예: 저장소 조회 오류) 이 Source만 오류로 보고하고
    // 다른 Source 처리는 계속돼야 한다(AGENTS.md: Source별 오류 격리) — pipeline.sync()가
    // 이미 이렇게 동작하므로 여기서도 같은 계약을 지킨다.
    const reason = error instanceof Error ? error.message : String(error);
    return { sourceId: collector.sourceId, collected: 0, created: 0, updated: 0, skipped: 0, errors: [reason] };
  }

  if (changed.length === 0) {
    return { sourceId: collector.sourceId, collected: 0, created: 0, updated: 0, skipped: rawItems.length, errors: diagnostics };
  }

  const result = await pipeline.sync(new FixedItemsCollector(collector, changed));

  // 배치 안 항목 하나라도 실패하면(pipeline.sync는 Source 단위로만 성공/실패를 구분해
  // 어떤 항목이 실패했는지 알려주지 않는다) 배치 전체를 커밋하지 않는다 — 성공한 항목까지
  // 같이 재시도되는 건 보수적이지만, 실패한 항목이 영영 스킵되는 것보다는 안전하다.
  if (result.errors.length === 0) {
    for (const item of changed) await rawItemRepository.save(item);
  } else if (options.jobQueue !== undefined) {
    // Job Queue가 있으면 무한 재시도 대신 여기서 재시도 책임을 넘긴다: 관찰 자체는
    // 지금 저장해 둔다(그래야 다음 tick이 "안 바뀜"으로 걸러 매번 반복하지 않는다)
    // — Fact 추출·해석은 Queue의 extract_facts Job이 Backoff·Dead Letter와 함께
    // 다시 시도한다. Job id는 RawItem id로 결정적이라 여러 tick에서 반복 enqueue해도
    // 하나만 남는다.
    const now = options.now ?? new Date();
    for (const item of changed) {
      await rawItemRepository.save(item);
      await options.jobQueue.enqueue({
        id: `extract_facts:${item.id}`,
        type: "extract_facts",
        inputRef: item.id,
        now,
      });
    }
  }

  return { ...result, errors: [...result.errors, ...diagnostics] };
}

async function filterChanged(items: RawItem[], repository: RawItemRepository): Promise<RawItem[]> {
  const changed: RawItem[] = [];
  for (const item of items) {
    const existing = item.externalId !== undefined
      ? await repository.findByExternalId(item.sourceId, item.externalId)
      : await repository.findByUri(item.sourceId, item.uri);
    if (existing === undefined || existing.contentHash !== item.contentHash) changed.push(item);
  }
  return changed;
}
