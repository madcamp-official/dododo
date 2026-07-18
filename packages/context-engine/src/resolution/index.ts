import type {
  ContextItem,
  ContextResolver,
  Fact,
} from "../../../shared/src/index.ts";
import { contextKindForFact } from "../classification/index.ts";

export class DeterministicContextResolver implements ContextResolver {
  async resolve(facts: Fact[], existing: ContextItem[]): Promise<ContextItem[]> {
    const now = new Date().toISOString();
    const knownTitles = new Set(existing.map((item) => normalize(item.title)));

    return facts
      .filter((fact) => !knownTitles.has(normalize(fact.subject)))
      .map((fact) => ({
        id: `ctx-${fact.id}`,
        kind: contextKindForFact(fact.kind),
        title: fact.subject,
        status: fact.confidence >= 0.8 ? "new" : "candidate",
        deadline: fact.kind === "deadline" ? fact.eventTime : undefined,
        startAt: fact.kind === "event" ? fact.eventTime : undefined,
        requirements: fact.kind === "requirement" ? [fact.value] : [],
        tags: [],
        priority: 0,
        confidence: fact.confidence,
        evidenceIds: [],
        metadata: { rawItemId: fact.rawItemId },
        createdAt: now,
        updatedAt: now,
      }));
  }
}

function normalize(value: string): string {
  return value.toLocaleLowerCase("ko-KR").replaceAll(/\s+/g, "").trim();
}
