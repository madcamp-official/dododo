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

// README의 5단계 권위 순위(최신 공식 공지 > 지정 공식 문서 > 외부 Calendar > 화면 분석 >
// LLM 추정)를 domain.ts의 4개 authority 값에 최대한 가깝게 매핑한다. calendar는
// 파일과 같은 user 등급으로 둔다 — 사용자가 직접 구독·관리하는 일정이라 화면 관찰보다는
// 신뢰할 수 있다고 보되, 공식 공지보다는 낮다. resolution/conflict.ts 참고.
function authorityFor(rawItem: RawItem): Evidence["authority"] {
  if (rawItem.metadata.official === true) return "official";
  if (rawItem.sourceType === "screen") return "observation";
  if (rawItem.sourceType === "file" || rawItem.sourceType === "calendar") return "user";
  return "derived";
}
