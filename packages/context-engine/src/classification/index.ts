import type { ContextKind, FactKind } from "../../../shared/src/index.ts";

export function contextKindForFact(kind: FactKind): ContextKind {
  if (kind === "opportunity") return "opportunity";
  if (kind === "event" || kind === "deadline") return "event";
  if (kind === "activity") return "activity";
  if (kind === "note") return "note";
  return "task";
}
