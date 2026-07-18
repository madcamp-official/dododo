import type { Evidence, Fact, RawItem } from "../../../shared/src/index.ts";

// Fact가 만들어진 원본 RawItem으로부터 근거 레코드를 만든다.
// id는 fact.id에서 결정론적으로 파생시켜, 같은 Fact가 다시 처리돼도 같은 Evidence id를
// 가리키게 한다(재동기화 시 중복 Evidence 방지).
export function buildEvidence(fact: Fact, rawItem: RawItem): Evidence {
  return {
    id: evidenceIdForFact(fact.id),
    rawItemId: rawItem.id,
    sourceType: rawItem.sourceType,
    location: rawItem.uri,
    quote: fact.evidenceText,
    observedAt: rawItem.observedAt,
    authority: authorityFor(rawItem),
  };
}

export function evidenceIdForFact(factId: string): string {
  return `ev-${factId}`;
}

function authorityFor(rawItem: RawItem): Evidence["authority"] {
  if (rawItem.metadata.official === true) return "official";
  if (rawItem.sourceType === "screen") return "observation";
  if (rawItem.sourceType === "file") return "user";
  return "derived";
}
