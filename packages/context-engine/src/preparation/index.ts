import { createHash } from "node:crypto";

import type { ContextChangeEvent, ContextItem } from "../../../shared/src/index.ts";

export interface OpportunityPreparation {
  opportunity: ContextItem;
  tasks: ContextItem[];
  event?: ContextItem;
  history: ContextChangeEvent[];
}

export function prepareOpportunity(
  opportunity: ContextItem,
  now: Date,
): OpportunityPreparation {
  if (opportunity.kind !== "opportunity") {
    throw new Error(`prepare는 Opportunity에만 사용할 수 있습니다: ${opportunity.kind}`);
  }

  const timestamp = now.toISOString();
  const requirements = opportunity.requirements.length > 0
    ? opportunity.requirements
    : [`${opportunity.title} 신청서 준비`];
  const sharedMetadata = { parentOpportunityId: opportunity.id, preparedFromOpportunity: true };
  const tasks = requirements.map((requirement): ContextItem => ({
    id: `ctx-prepare-task-${opportunity.id}-${requirementKey(requirement)}`,
    kind: "task",
    title: requirement,
    status: "todo",
    deadline: opportunity.deadline,
    requirements: [],
    tags: [...opportunity.tags, "preparation"],
    priority: 0,
    confidence: opportunity.confidence,
    evidenceIds: [...opportunity.evidenceIds],
    metadata: { ...sharedMetadata, preparationRequirementKey: requirementKey(requirement) },
    createdAt: timestamp,
    updatedAt: timestamp,
  }));

  const event = opportunity.deadline === undefined ? undefined : {
    id: `ctx-prepare-event-${opportunity.id}`,
    kind: "event" as const,
    title: `${opportunity.title} 신청 마감`,
    status: "confirmed" as const,
    startAt: opportunity.deadline,
    requirements: [],
    tags: [...opportunity.tags, "deadline"],
    priority: 0,
    confidence: opportunity.confidence,
    evidenceIds: [...opportunity.evidenceIds],
    metadata: sharedMetadata,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  const preparedOpportunity: ContextItem = {
    ...opportunity,
    status: "preparing",
    updatedAt: timestamp,
  };
  const derivedItems = [...tasks, ...(event === undefined ? [] : [event])];
  const history: ContextChangeEvent[] = [
    {
      id: `hist-prepare-status-${opportunity.id}`,
      contextItemId: opportunity.id,
      changeType: "status_changed",
      field: "status",
      previousValue: opportunity.status,
      newValue: "preparing",
      evidenceId: opportunity.evidenceIds[0],
      changedAt: timestamp,
    },
    ...derivedItems.map((item): ContextChangeEvent => ({
      id: `hist-prepare-created-${item.id}`,
      contextItemId: item.id,
      changeType: "created",
      evidenceId: item.evidenceIds[0],
      changedAt: timestamp,
    })),
  ];

  return {
    opportunity: preparedOpportunity,
    tasks,
    history,
    ...(event === undefined ? {} : { event }),
  };
}

function requirementKey(requirement: string): string {
  const normalized = requirement.trim().toLocaleLowerCase("ko-KR").replace(/\s+/g, " ");
  return createHash("sha256").update(normalized).digest("hex").slice(0, 12);
}
