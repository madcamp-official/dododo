import type { ContextItem, Evidence } from "../../shared/src/index.ts";

// 다중 출처 병합 정확도 채점. "같은 공지가 사이트·이메일에 있으면 하나의 ContextItem으로
// 병합된다"가 얼마나 지켜졌는지 측정한다. Evidence.rawItemId로 어떤 RawItem이 어떤
// ContextItem에 들어갔는지 역추적한다.
export interface MergeFailure {
  type: "not_merged" | "false_merge" | "duplicate_context";
  rawItemIds: string[];
  contextItemIds?: string[];
}

export interface MergeAccuracyEvaluation {
  // 기대한 병합 쌍 중 실제로 같은 ContextItem에 모인 비율(0~1). false merge가 있으면
  // 그만큼 감점한다.
  accuracy: number;
  expectedMergeCount: number;
  correctMerges: number;
  falseMerges: number;
  duplicateAssignments: number;
  failures: MergeFailure[];
}

export function evaluateMergeAccuracy(
  expectedMerges: [string, string][],
  items: ContextItem[],
  evidence: Evidence[],
): MergeAccuracyEvaluation {
  const contextItemsByRawItem = buildRawItemToContextsMap(items, evidence);
  const failures: MergeFailure[] = [];
  let correctMerges = 0;

  let duplicateAssignments = 0;
  for (const [rawItemId, contextItems] of contextItemsByRawItem) {
    if (contextItems.length <= 1) continue;
    duplicateAssignments += 1;
    failures.push({
      type: "duplicate_context",
      rawItemIds: [rawItemId],
      contextItemIds: contextItems.map((item) => item.id),
    });
  }

  for (const [rawA, rawB] of expectedMerges) {
    const itemsA = contextItemsByRawItem.get(rawA) ?? [];
    const itemsB = contextItemsByRawItem.get(rawB) ?? [];
    if (itemsA.length === 1 && itemsB.length === 1 && itemsA[0]!.id === itemsB[0]!.id) {
      correctMerges += 1;
    } else {
      failures.push({ type: "not_merged", rawItemIds: [rawA, rawB] });
    }
  }

  // 예상 밖 병합(false merge): 기대 목록에 없는데 같은 ContextItem에 모인 서로 다른
  // 출처 RawItem 쌍. 서로 다른 externalId가 우연히 병합되면 안 되기 때문이다.
  const expectedSet = new Set(expectedMerges.map(pairKey));
  let falseMerges = 0;
  for (const rawItemIds of groupRawItemsByContext(contextItemsByRawItem)) {
    for (const pair of allPairs(rawItemIds)) {
      if (!expectedSet.has(pairKey(pair))) {
        falseMerges += 1;
        failures.push({ type: "false_merge", rawItemIds: pair });
      }
    }
  }

  const expectedMergeCount = expectedMerges.length;
  const totalErrors = falseMerges + duplicateAssignments;
  const base = expectedMergeCount === 0 ? (totalErrors === 0 ? 1 : 0) : correctMerges / expectedMergeCount;
  const penalty = expectedMergeCount === 0 ? 0 : totalErrors / expectedMergeCount;
  const accuracy = clamp(base - penalty, 0, 1);

  return {
    accuracy,
    expectedMergeCount,
    correctMerges,
    falseMerges,
    duplicateAssignments,
    failures,
  };
}

function buildRawItemToContextsMap(items: ContextItem[], evidence: Evidence[]): Map<string, ContextItem[]> {
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  const map = new Map<string, ContextItem[]>();
  for (const item of items) {
    for (const evidenceId of item.evidenceIds) {
      const rawItemId = evidenceById.get(evidenceId)?.rawItemId;
      if (rawItemId === undefined) continue;
      const list = map.get(rawItemId) ?? [];
      if (!list.some((existing) => existing.id === item.id)) list.push(item);
      map.set(rawItemId, list);
    }
  }
  return map;
}

function groupRawItemsByContext(map: Map<string, ContextItem[]>): string[][] {
  const byContext = new Map<string, string[]>();
  for (const [rawItemId, items] of map) {
    for (const item of items) {
      const list = byContext.get(item.id) ?? [];
      list.push(rawItemId);
      byContext.set(item.id, list);
    }
  }
  return [...byContext.values()].filter((group) => group.length > 1);
}

function allPairs(values: string[]): [string, string][] {
  const pairs: [string, string][] = [];
  for (let i = 0; i < values.length; i += 1) {
    for (let j = i + 1; j < values.length; j += 1) {
      pairs.push([values[i]!, values[j]!]);
    }
  }
  return pairs;
}

function pairKey(pair: [string, string]): string {
  return [...pair].sort().join("\0");
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
