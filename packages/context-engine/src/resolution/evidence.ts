import type { Evidence, Fact, RawItem } from "../../../shared/src/index.ts";
import { structuredDueAt } from "../extraction/index.ts";

// Fact가 만들어진 원본 RawItem으로부터 근거 레코드를 만든다.
// id는 fact.id에서 결정론적으로 파생시켜, 같은 Fact가 다시 처리돼도 같은 Evidence id를
// 가리키게 한다(재동기화 시 중복 Evidence 방지).
export function buildEvidence(fact: Fact, rawItem: RawItem): Evidence {
  return {
    id: evidenceIdForFact(fact.id),
    rawItemId: rawItem.id,
    sourceType: rawItem.sourceType,
    location: rawItem.uri,
    quote: buildQuote(fact, rawItem),
    observedAt: rawItem.observedAt,
    authority: authorityFor(rawItem),
  };
}

// evidenceText는 LLM이 본문에서 그대로 따온 인용문이다. 그런데 Fact의 제목·마감이
// RawItem.metadata의 구조화 값(canonicalTitle/dueAt)으로 대체되면, 저장된 값을 그
// 인용문만으로는 확인할 수 없다(김도연님 리뷰 P1 — "덮어쓴 값과 evidenceText가 서로
// 다른 사실을 가리킬 수 있다"). 구조화 값도 같은 RawItem을 파싱해 얻은 원본 신호이므로,
// 인용문 뒤에 출처를 명시해 함께 보존한다 — 지어낸 문장을 인용문에 섞지 않으면서도
// "이 마감이 어디서 왔는지"를 evidence 명령에서 그대로 볼 수 있다.
function buildQuote(fact: Fact, rawItem: RawItem): string {
  const notes: string[] = [];
  const canonicalTitle = rawItem.metadata.canonicalTitle;
  const dueAt = structuredDueAt(rawItem);

  if (typeof canonicalTitle === "string" && fact.subject === canonicalTitle) {
    notes.push(`[구조화 필드] canonicalTitle: ${canonicalTitle}`);
  }
  if (dueAt !== undefined && fact.eventTime === dueAt) {
    notes.push(`[구조화 필드] dueAt: ${dueAt}`);
  }

  // 인용문이 이미 그 값을 담고 있으면 덧붙이지 않는다.
  const unseen = notes.filter((note) => !fact.evidenceText.includes(note.split(": ")[1] ?? ""));
  return unseen.length === 0 ? fact.evidenceText : [fact.evidenceText, ...unseen].join("\n");
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
