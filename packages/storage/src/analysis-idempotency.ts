import type { Fact, StoredFact } from "../../shared/src/index.ts";

export function hasSameActiveFacts(existing: StoredFact[], incoming: Fact[]): boolean {
  if (existing.length !== incoming.length) return false;

  const incomingById = new Map(incoming.map((fact) => [fact.id, fact]));
  if (incomingById.size !== incoming.length) return false;

  return existing.every((stored) => {
    const fact = incomingById.get(stored.id);
    return stored.status === "active"
      && fact !== undefined
      && stored.rawItemId === fact.rawItemId
      && stored.kind === fact.kind
      && stored.subject === fact.subject
      && stored.value === fact.value
      && stored.eventTime === fact.eventTime
      && stored.confidence === fact.confidence
      && stored.evidenceText === fact.evidenceText;
  });
}
