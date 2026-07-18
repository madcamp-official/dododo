import type { ContextKind, ContextStatus, Fact, RawItem } from "../../../shared/src/index.ts";

// RawItem의 metadata 신호가 있으면 Fact.kind보다 우선한다.
// 예: 학교 공지 Fixture의 metadata.category === "competition"은 공모전 공지이므로
// LLM이 kind를 task로 잘못 매겼더라도 opportunity로 강제 분류한다.
export function contextKindForFact(fact: Fact, rawItem?: RawItem): ContextKind {
  if (rawItem?.metadata.category === "competition") return "opportunity";
  if (fact.kind === "opportunity") return "opportunity";
  if (fact.kind === "event" || fact.kind === "deadline") return "event";
  if (fact.kind === "activity") return "activity";
  if (fact.kind === "note") return "note";
  return "task";
}

// 낮은 확신도나 시각이 없는(모호한) 마감·일정은 자동 확정하지 않고 candidate로 둔다.
export function classifyConfidenceGate(fact: Fact): ContextStatus {
  if (fact.confidence < 0.6) return "candidate";

  if (fact.kind === "deadline" || fact.kind === "event") {
    if (fact.eventTime === undefined || !hasExplicitTime(fact.eventTime)) return "candidate";
  }

  return fact.confidence >= 0.8 ? "new" : "candidate";
}

// eventTime은 항상 ISO date-time 문자열이므로, 시각이 정오·자정(00:00)으로 뭉쳐 있으면
// 원문에 시각이 없어 추출기가 날짜만 채운 것으로 간주한다. 실제로 자정 마감인 경우도
// candidate로 남는 것은 알려진 단순화이며, Stage 3 이후 실제 원문 재확인으로 보완한다.
function hasExplicitTime(eventTime: string): boolean {
  const match = /T(\d{2}):(\d{2})/.exec(eventTime);
  if (match === null) return false;
  return !(match[1] === "00" && match[2] === "00");
}
