// TEMP: Intelligence 팀 FactExtractor 완성되면 교체 (packages/context-engine/src/extraction).
// RawItem의 title/content만 보고 Fact 1개를 만드는 최소 휴리스틱이며, 실제 LLM 기반 추출을 대신하지 않는다.
import type { Fact, FactExtractor, FactKind, RawItem } from "../../../../packages/shared/src/index.ts";

const KIND_BY_SOURCE: Partial<Record<RawItem["sourceType"], FactKind>> = {
  "school-site": "opportunity",
  "school-email": "opportunity",
  lms: "task",
};

export class TempHeuristicFactExtractor implements FactExtractor {
  async extract(rawItem: RawItem): Promise<Fact[]> {
    const kind = KIND_BY_SOURCE[rawItem.sourceType];
    if (kind === undefined || rawItem.title === undefined) return [];

    const fact: Fact = {
      id: `fact-${rawItem.id}`,
      rawItemId: rawItem.id,
      kind,
      subject: rawItem.title,
      value: rawItem.content,
      confidence: 0.9,
      evidenceText: rawItem.content,
    };

    return [fact];
  }
}
