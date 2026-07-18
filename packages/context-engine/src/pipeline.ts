import type {
  Collector,
  ContextItem,
  ContextRepository,
  ContextResolver,
  Fact,
  FactExtractor,
  PrivacyGateway,
  RawItem,
  SyncResult,
} from "../../shared/src/index.ts";
import { isEvidenceAware } from "./resolution/index.ts";
import { InterimContextStore } from "./store/index.ts";

export interface ContextPipelineDependencies {
  repository: ContextRepository;
  privacyGateway: PrivacyGateway;
  factExtractor: FactExtractor;
  contextResolver: ContextResolver;
  // 지정하지 않으면 파이프라인이 자체적으로 하나를 만들어 이 인스턴스의 생애주기 동안
  // 재사용한다. packages/shared/src/contracts.ts의 ContextRepository가 아직 Evidence를
  // 저장할 방법이 없어(docs/proposals/context-repository-contract-extension.md) 임시로
  // 여기서 관리한다.
  evidenceStore?: InterimContextStore;
}

interface ResolveResult {
  createdItems: ContextItem[];
  updatedItems: ContextItem[];
}

export class ContextPipeline {
  private readonly dependencies: ContextPipelineDependencies;
  readonly evidenceStore: InterimContextStore;

  constructor(dependencies: ContextPipelineDependencies) {
    this.dependencies = dependencies;
    this.evidenceStore = dependencies.evidenceStore ?? new InterimContextStore();
  }

  async sync(collector: Collector): Promise<SyncResult> {
    try {
      const rawItems = await collector.sync();
      await this.dependencies.repository.saveRawItems(rawItems);

      const rawItemsById = new Map(rawItems.map((item) => [item.id, item]));
      const existing = await this.dependencies.repository.listContextItems();
      let created = 0;
      let updated = 0;

      for (const rawItem of rawItems) {
        const safeItem = await this.dependencies.privacyGateway.prepare(rawItem);
        const facts = await this.dependencies.factExtractor.extract(safeItem);
        await this.dependencies.repository.saveFacts(facts);

        const { createdItems, updatedItems } = await this.resolve(facts, existing, rawItemsById);
        await this.dependencies.repository.saveContextItems([...createdItems, ...updatedItems]);

        applyToWorkingSet(existing, createdItems, updatedItems);
        created += createdItems.length;
        updated += updatedItems.length;
      }

      return {
        sourceId: collector.sourceId,
        collected: rawItems.length,
        created,
        updated,
        skipped: Math.max(rawItems.length - created - updated, 0),
        errors: [],
      };
    } catch (error) {
      return {
        sourceId: collector.sourceId,
        collected: 0,
        created: 0,
        updated: 0,
        skipped: 0,
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  // Evidence를 채우려면 원본 RawItem과 기존 Evidence가 필요하다. Resolver가
  // resolveWithEvidence를 구현하면(예: DeterministicContextResolver) 그 경로를 쓰고,
  // 아니면 ContextResolver 계약의 좁은 resolve()로 그대로 폴백한다 — 다른 팀원이나
  // 테스트가 narrow mock Resolver를 넣어도 파이프라인이 깨지지 않는다.
  private async resolve(
    facts: Fact[],
    existing: ContextItem[],
    rawItemsById: Map<string, RawItem>,
  ): Promise<ResolveResult> {
    const resolver = this.dependencies.contextResolver;

    if (!isEvidenceAware(resolver)) {
      const items = await resolver.resolve(facts, existing);
      return { createdItems: items, updatedItems: [] };
    }

    const existingEvidenceIds = existing.flatMap((item) => item.evidenceIds);
    const existingEvidence = await this.evidenceStore.listEvidence(existingEvidenceIds);

    const outcome = await resolver.resolveWithEvidence(facts, existing, {
      rawItemsById,
      existingEvidence,
    });
    await this.evidenceStore.saveEvidence(outcome.evidence);
    await this.evidenceStore.saveContextHistory(outcome.history);
    return { createdItems: outcome.createdItems, updatedItems: outcome.updatedItems };
  }
}

// 같은 sync() 호출 안에서 뒤이은 RawItem의 Fact가 방금 만들거나 갱신한 항목을 다시
// 병합 후보로 볼 수 있도록, existing 작업 배열을 제자리에서 갱신한다.
function applyToWorkingSet(
  existing: ContextItem[],
  createdItems: ContextItem[],
  updatedItems: ContextItem[],
): void {
  existing.push(...createdItems);

  for (const item of updatedItems) {
    const index = existing.findIndex((candidate) => candidate.id === item.id);
    if (index === -1) existing.push(item);
    else existing[index] = item;
  }
}
