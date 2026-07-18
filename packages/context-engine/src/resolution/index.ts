import type {
  ContextItem,
  ContextResolver,
  Evidence,
  Fact,
  RawItem,
} from "../../../shared/src/index.ts";
import { classifyConfidenceGate, contextKindForFact } from "../classification/index.ts";
import { buildEvidence } from "./evidence.ts";

export * from "./evidence.ts";

export interface ResolveContext {
  rawItemsById: Map<string, RawItem>;
  existingEvidence: Evidence[];
}

// packages/shared/src/contracts.ts의 ContextResolver를 아직 넓히지 못했으므로
// (docs/proposals/context-repository-contract-extension.md 참고), Evidence를 채우려는
// 호출부(ContextPipeline)는 이 메서드를 duck-typing으로 탐지해 사용하고, 지원하지 않는
// Resolver(예: 테스트의 narrow mock)는 기존 2-인자 resolve()로 폴백한다.
export interface EvidenceAwareContextResolver extends ContextResolver {
  resolveWithEvidence(
    facts: Fact[],
    existing: ContextItem[],
    context: ResolveContext,
  ): Promise<{ items: ContextItem[]; evidence: Evidence[] }>;
}

export function isEvidenceAware(
  resolver: ContextResolver,
): resolver is EvidenceAwareContextResolver {
  return typeof (resolver as Partial<EvidenceAwareContextResolver>).resolveWithEvidence === "function";
}

export class DeterministicContextResolver implements EvidenceAwareContextResolver {
  // context 없이 직접 호출되면(예: 파이프라인을 거치지 않는 단독 테스트) Evidence 없이
  // 동작한다 — ContextResolver 계약을 그대로 만족시키기 위한 폴백 경로다.
  async resolve(facts: Fact[], existing: ContextItem[]): Promise<ContextItem[]> {
    const { items } = await this.resolveWithEvidence(facts, existing, {
      rawItemsById: new Map(),
      existingEvidence: [],
    });
    return items;
  }

  async resolveWithEvidence(
    facts: Fact[],
    existing: ContextItem[],
    context: ResolveContext,
  ): Promise<{ items: ContextItem[]; evidence: Evidence[] }> {
    const now = new Date().toISOString();
    const knownTitles = new Set(existing.map((item) => normalize(item.title)));
    const newEvidence: Evidence[] = [];

    // 제목이 이미 존재하는 Fact는 지금 단계에서는 그냥 버린다(Evidence를 기존 항목에
    // 추가하는 병합은 Stage 3의 병합 점수 로직이 담당한다).
    const items = facts
      .filter((fact) => !knownTitles.has(normalize(fact.subject)))
      .map((fact) => {
        const rawItem = context.rawItemsById.get(fact.rawItemId);
        const evidenceIds: string[] = [];

        if (rawItem !== undefined) {
          const evidence = buildEvidence(fact, rawItem);
          newEvidence.push(evidence);
          evidenceIds.push(evidence.id);
        }

        const item: ContextItem = {
          id: `ctx-${fact.id}`,
          kind: contextKindForFact(fact, rawItem),
          title: fact.subject,
          status: classifyConfidenceGate(fact),
          deadline: fact.kind === "deadline" ? fact.eventTime : undefined,
          startAt: fact.kind === "event" ? fact.eventTime : undefined,
          requirements: fact.kind === "requirement" ? [fact.value] : [],
          tags: [],
          priority: 0,
          confidence: fact.confidence,
          evidenceIds,
          metadata: { rawItemId: fact.rawItemId },
          createdAt: now,
          updatedAt: now,
        };
        return item;
      });

    return { items, evidence: newEvidence };
  }
}

function normalize(value: string): string {
  return value.toLocaleLowerCase("ko-KR").replaceAll(/\s+/g, "").trim();
}
