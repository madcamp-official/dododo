import type {
  ContextItem,
  ContextResolver,
  Evidence,
  Fact,
  RawItem,
} from "../../../shared/src/index.ts";
import { classifyConfidenceGate, contextKindForFact } from "../classification/index.ts";
import type { ContextChangeEvent } from "../store/types.ts";
import { resolveConflict } from "./conflict.ts";
import { buildEvidence } from "./evidence.ts";
import { computeMergeScore, pickSubjectSignal, type MergeScoreBreakdown } from "./mergeScore.ts";

export * from "./conflict.ts";
export * from "./evidence.ts";
export * from "./mergeScore.ts";
export * from "./similarity.ts";

export interface ResolveContext {
  rawItemsById: Map<string, RawItem>;
  existingEvidence: Evidence[];
}

export interface ResolveOutcome {
  createdItems: ContextItem[];
  updatedItems: ContextItem[];
  evidence: Evidence[];
  history: ContextChangeEvent[];
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
  ): Promise<ResolveOutcome>;
}

export function isEvidenceAware(
  resolver: ContextResolver,
): resolver is EvidenceAwareContextResolver {
  return typeof (resolver as Partial<EvidenceAwareContextResolver>).resolveWithEvidence === "function";
}

const AUTO_MERGE_THRESHOLD = 70;
const CONFIRM_MERGE_THRESHOLD = 40;

export class DeterministicContextResolver implements EvidenceAwareContextResolver {
  // context 없이 직접 호출되면(예: 파이프라인을 거치지 않는 단독 테스트) Evidence 없이
  // 동작한다 — ContextResolver 계약을 그대로 만족시키기 위한 폴백 경로다. RawItem 정보가
  // 없으면 병합 점수를 계산할 수 없어 모든 Fact가 새 항목으로 생성된다.
  async resolve(facts: Fact[], existing: ContextItem[]): Promise<ContextItem[]> {
    const outcome = await this.resolveWithEvidence(facts, existing, {
      rawItemsById: new Map(),
      existingEvidence: [],
    });
    return [...outcome.createdItems, ...outcome.updatedItems];
  }

  async resolveWithEvidence(
    facts: Fact[],
    existing: ContextItem[],
    context: ResolveContext,
  ): Promise<ResolveOutcome> {
    const now = new Date().toISOString();
    const createdItems: ContextItem[] = [];
    const updatedItems: ContextItem[] = [];
    const newEvidence: Evidence[] = [];
    const history: ContextChangeEvent[] = [];

    // 이번 sync 호출 안에서 방금 만든/갱신한 항목도 뒤이은 Fact의 병합 후보가 될 수
    // 있어야 하므로, existing을 복사해 계속 갱신되는 작업용 맵으로 관리한다.
    const workingItems = new Map(existing.map((item) => [item.id, item]));

    // context.existingEvidence는 이 호출이 시작될 때의 스냅샷이라, 같은 호출 안에서
    // 새로 만든 Evidence는 반영되지 않는다. 하나의 RawItem에서 Fact가 여러 개 나오면
    // (LLMFactExtractor가 실제로 그렇게 반환할 수 있다) 뒤쪽 Fact가 방금 만든 항목과
    // 병합될 때 그 항목의 Evidence를 찾지 못해 권위 비교를 건너뛰고 무조건 덮어쓰는
    // 버그가 있었다 — 매번 갱신되는 맵으로 바꿔 같은 batch 안에서 만든 Evidence도
    // 곧바로 권위 비교 대상이 되게 한다.
    const evidenceById = new Map(context.existingEvidence.map((item) => [item.id, item]));

    for (const fact of facts) {
      const rawItem = context.rawItemsById.get(fact.rawItemId);
      const kind = contextKindForFact(fact, rawItem);
      const evidence = rawItem === undefined ? undefined : buildEvidence(fact, rawItem);
      if (evidence !== undefined) {
        newEvidence.push(evidence);
        evidenceById.set(evidence.id, evidence);
      }

      const best = rawItem === undefined
        ? undefined
        : findBestMatch(fact, rawItem, kind, workingItems, [...evidenceById.values()]);

      if (best !== undefined && best.breakdown.total >= AUTO_MERGE_THRESHOLD) {
        const evidenceForItem = [...evidenceById.values()].filter((item) =>
          best.item.evidenceIds.includes(item.id)
        );
        const merged = mergeFactIntoItem(best.item, fact, kind, evidence, evidenceForItem, now, history);
        workingItems.set(merged.id, merged);
        updatedItems.push(merged);
        continue;
      }

      if (best !== undefined && best.breakdown.total >= CONFIRM_MERGE_THRESHOLD) {
        const pending = buildContextItem(fact, kind, rawItem, evidence, now, {
          status: "candidate",
          pendingMergeWithId: best.item.id,
          pendingMergeScore: best.breakdown.total,
        });
        workingItems.set(pending.id, pending);
        createdItems.push(pending);
        history.push(createdEvent(pending, evidence, now));
        continue;
      }

      const created = buildContextItem(fact, kind, rawItem, evidence, now, {
        status: classifyConfidenceGate(fact),
      });
      workingItems.set(created.id, created);
      createdItems.push(created);
      history.push(createdEvent(created, evidence, now));
    }

    return { createdItems, updatedItems, evidence: newEvidence, history };
  }
}

function findBestMatch(
  fact: Fact,
  rawItem: RawItem,
  kind: ContextItem["kind"],
  workingItems: Map<string, ContextItem>,
  existingEvidence: Evidence[],
): { item: ContextItem; breakdown: MergeScoreBreakdown } | undefined {
  let best: { item: ContextItem; breakdown: MergeScoreBreakdown } | undefined;

  for (const item of workingItems.values()) {
    if (item.kind !== kind) continue;

    const breakdown = computeMergeScore({ fact, rawItem, kind }, item, existingEvidence);
    if (best === undefined || breakdown.total > best.breakdown.total) {
      best = { item, breakdown };
    }
  }

  return best;
}

// 70점 이상 자동 병합: 새 Evidence를 추가하고, 마감·일정 필드는 권위 순위로 충돌을
// 해결한 뒤 실제로 값이 바뀌면 변경 이력을 남긴다. deadline/startAt 여부는 fact.kind가
// 아니라 분류가 끝난 ContextKind로 판단한다 — "과제 3은 7/22까지 제출"처럼 kind가
// task로 태깅된 Fact도 eventTime이 있으면 마감으로 다뤄야 하기 때문이다.
function mergeFactIntoItem(
  existing: ContextItem,
  fact: Fact,
  kind: ContextItem["kind"],
  evidence: Evidence | undefined,
  evidenceForItem: Evidence[],
  now: string,
  history: ContextChangeEvent[],
): ContextItem {
  const updated: ContextItem = structuredClone(existing);
  updated.updatedAt = now;

  history.push({
    id: `hist-merge-${evidence?.id ?? fact.id}`,
    contextItemId: existing.id,
    changeType: "merged",
    evidenceId: evidence?.id,
    changedAt: now,
  });

  if (evidence !== undefined && !updated.evidenceIds.includes(evidence.id)) {
    updated.evidenceIds = [...updated.evidenceIds, evidence.id];
    history.push({
      id: `hist-evidence-${evidence.id}`,
      contextItemId: existing.id,
      changeType: "evidence_added",
      evidenceId: evidence.id,
      changedAt: now,
    });
  }

  if (evidence !== undefined && hasDeadline(kind) && fact.eventTime !== undefined) {
    applyConflictAwareField(updated, "deadline", fact.eventTime, evidence, evidenceForItem, history, now);
  }
  if (evidence !== undefined && kind === "event" && fact.eventTime !== undefined) {
    applyConflictAwareField(updated, "startAt", fact.eventTime, evidence, evidenceForItem, history, now);
  }
  if (fact.kind === "requirement" && !updated.requirements.includes(fact.value)) {
    updated.requirements = [...updated.requirements, fact.value];
  }

  return updated;
}

// 현재 필드값(deadline/startAt)을 실제로 뒷받침하는 Evidence 하나와 새 Evidence를
// 비교해, 새 Evidence가 이기는 경우에만 필드를 갱신하고 이전 값을 이력에 남긴다.
// "그 필드를 뒷받침하는 근거"는 metadata에 필드별로 추적한다(fieldEvidenceIdKey) —
// 카드 전체 evidenceIds 중 가장 권위 높은 것과 비교하면, 제목·요구사항만 뒷받침하는
// 고권위 근거가 마감 갱신을 영구히 막는 문제가 생긴다(김도연님 #13 리뷰 지적 2).
// 필드 근거 추적 정보가 없으면(예: 추적 이전에 만들어진 값) 차단할 근거가 없으므로
// 갱신을 허용한다.
function applyConflictAwareField(
  item: ContextItem,
  field: "deadline" | "startAt",
  newValue: string,
  newEvidence: Evidence,
  evidenceForItem: Evidence[],
  history: ContextChangeEvent[],
  now: string,
): void {
  const previousValue = item[field];
  if (previousValue === newValue) return;

  const evidenceIdKey = fieldEvidenceIdKey(field);

  if (previousValue !== undefined) {
    const currentEvidenceId = item.metadata[evidenceIdKey];
    const currentFieldEvidence = typeof currentEvidenceId === "string"
      ? evidenceForItem.find((candidate) => candidate.id === currentEvidenceId)
      : undefined;
    if (
      currentFieldEvidence !== undefined
      && resolveConflict(currentFieldEvidence, newEvidence) !== newEvidence
    ) {
      return;
    }
  }

  item[field] = newValue;
  item.metadata[evidenceIdKey] = newEvidence.id;
  history.push({
    id: `hist-${newEvidence.id}-${field}`,
    contextItemId: item.id,
    changeType: "field_updated",
    field,
    previousValue,
    newValue,
    evidenceId: newEvidence.id,
    changedAt: now,
  });
}

function fieldEvidenceIdKey(field: "deadline" | "startAt"): string {
  return field === "deadline" ? "deadlineEvidenceId" : "startAtEvidenceId";
}

interface NewItemOptions {
  status: ContextItem["status"];
  pendingMergeWithId?: string;
  pendingMergeScore?: number;
}

function buildContextItem(
  fact: Fact,
  kind: ContextItem["kind"],
  rawItem: RawItem | undefined,
  evidence: Evidence | undefined,
  now: string,
  options: NewItemOptions,
): ContextItem {
  const deadline = hasDeadline(kind) ? fact.eventTime : undefined;
  const startAt = kind === "event" ? fact.eventTime : undefined;

  return {
    id: `ctx-${fact.id}`,
    kind,
    title: fact.subject,
    status: options.status,
    deadline,
    startAt,
    requirements: fact.kind === "requirement" ? [fact.value] : [],
    tags: deriveTags(kind, rawItem),
    priority: 0,
    confidence: fact.confidence,
    evidenceIds: evidence !== undefined ? [evidence.id] : [],
    metadata: {
      rawItemId: fact.rawItemId,
      ...classificationMetadata(rawItem),
      // 생성 시점의 마감·일정 값을 뒷받침하는 근거를 필드별로 기록해 둔다 —
      // 이후 병합에서 충돌 해결이 "이 필드를 실제로 뒷받침하는 근거"끼리만 비교하게 한다.
      ...(evidence !== undefined && deadline !== undefined ? { deadlineEvidenceId: evidence.id } : {}),
      ...(evidence !== undefined && startAt !== undefined ? { startAtEvidenceId: evidence.id } : {}),
      ...(options.pendingMergeWithId !== undefined
        ? { pendingMergeWithId: options.pendingMergeWithId, pendingMergeScore: options.pendingMergeScore }
        : {}),
    },
    createdAt: now,
    updatedAt: now,
  };
}

// 병합 점수 계산이 이후 Fact와도 course/category를 비교할 수 있도록, 생성 시점에
// RawItem의 분류 신호를 ContextItem.metadata로 옮겨 둔다.
function classificationMetadata(rawItem: RawItem | undefined): Record<string, unknown> {
  if (rawItem === undefined) return {};
  const metadata: Record<string, unknown> = {};
  if (typeof rawItem.metadata.course === "string") metadata.course = rawItem.metadata.course;
  if (typeof rawItem.metadata.category === "string") metadata.category = rawItem.metadata.category;
  return metadata;
}

// recommendation/priority.ts의 중요도 계산이 profile.interests/activityTypes와 겹치는지
// 볼 수 있도록, kind와 RawItem의 course/category 신호를 태그로 옮겨 둔다. 지금은 이
// 두 신호뿐이라 소박하지만, Stage 6에서 화면 Activity 연결 등으로 풍부해질 수 있다.
function deriveTags(kind: ContextItem["kind"], rawItem: RawItem | undefined): string[] {
  const tags: string[] = [kind];
  const subject = rawItem === undefined ? undefined : pickSubjectSignal(rawItem.metadata);
  if (subject !== undefined) tags.push(subject);
  return tags;
}

// Opportunity(신청 마감)와 Task(제출 마감) 둘 다 의미 있는 deadline을 가진다
// (user-scenarios.md 시나리오 1: "신청 마감: 2026-07-25 18:00"). Event만 startAt을 쓴다.
function hasDeadline(kind: ContextItem["kind"]): boolean {
  return kind === "task" || kind === "opportunity";
}

function createdEvent(item: ContextItem, evidence: Evidence | undefined, now: string): ContextChangeEvent {
  return {
    id: `hist-created-${item.id}`,
    contextItemId: item.id,
    changeType: "created",
    evidenceId: evidence?.id,
    changedAt: now,
  };
}
