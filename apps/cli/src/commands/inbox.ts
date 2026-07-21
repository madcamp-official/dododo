import { emptyProfile, type CliContainer } from "../runtime/container.ts";
import { renderIdLookupFailure, resolveContextItemId } from "../runtime/resolveContextItemId.ts";
import { isSnoozed } from "../runtime/snooze.ts";
import {
  isExcludedContextStatus,
  prepareOpportunity,
} from "../../../../packages/context-engine/src/index.ts";
import type { ContextItem, Recommendation } from "../../../../packages/shared/src/index.ts";

export interface RecommendedEntry {
  item: ContextItem;
  recommendation: Recommendation;
}

export interface InboxResult {
  // "Opportunity 자체가 없다"와 "있는데 전부 snooze됨"을 구분하는 데 쓴다(today.ts와 동일 이유).
  items: ContextItem[];
  entries: RecommendedEntry[];
}

export async function listInboxEntries(container: CliContainer, now: Date = new Date()): Promise<InboxResult> {
  const items = await container.repository.listContextItems("opportunity");
  if (items.length === 0) return { items, entries: [] };

  const profile = (await container.profileRepository.get()) ?? emptyProfile();
  const recommendations = await container.recommendationEngine.recommend(items, profile, now);
  const itemsById = new Map(items.map((item) => [item.id, item]));

  const entries: RecommendedEntry[] = [];
  for (const recommendation of recommendations) {
    const item = itemsById.get(recommendation.contextItemId);
    if (item === undefined || isSnoozed(item, now)) continue;
    entries.push({ item, recommendation });
  }

  return { items, entries };
}

const USAGE = "사용법: dododo inbox [prepare <opportunity-id>]";

export async function runInbox(
  container: CliContainer,
  args: string[],
  now: Date = new Date(),
): Promise<string> {
  if (args.length === 0) return renderInbox(container, now);
  const [action, id, ...rest] = args;
  if (action !== "prepare" || id === undefined || rest.length > 0) return USAGE;

  const lookup = await resolveContextItemId(container, id);
  if (lookup.kind !== "found") return renderIdLookupFailure(id, lookup);
  const item = lookup.item;
  if (item.kind !== "opportunity") return `prepare 대상은 Opportunity여야 합니다: ${item.kind}`;
  if (item.status === "preparing") return `이미 준비 중인 Opportunity입니다: ${item.title}`;
  if (isExcludedContextStatus(item.status)) {
    return `종료된 Opportunity는 다시 준비할 수 없습니다: ${item.title} (${item.status})`;
  }

  const prepared = prepareOpportunity(item, now);
  await container.repository.saveContextItems([
    prepared.opportunity,
    ...prepared.tasks,
    ...(prepared.event === undefined ? [] : [prepared.event]),
  ]);
  await container.repository.saveContextHistory(prepared.history);

  const lines = [
    `준비를 시작했습니다: ${item.title}`,
    ...prepared.tasks.map((task) => `Task: ${task.title} (${task.id})`),
  ];
  if (prepared.event !== undefined) {
    lines.push(`Event: ${prepared.event.title} (${prepared.event.startAt})`);
  }
  return lines.join("\n");
}

export async function renderInbox(container: CliContainer, now: Date = new Date()): Promise<string> {
  const { items, entries } = await listInboxEntries(container, now);

  if (items.length === 0) {
    return [
      "Opportunity Inbox",
      "",
      "등록된 Opportunity가 없습니다. `npm start -- sync`를 먼저 실행하세요.",
    ].join("\n");
  }

  const lines = ["Opportunity Inbox", ""];
  for (const { item, recommendation } of entries) {
    lines.push(`[${item.id}] 관련도 ${Math.round(recommendation.score)}  ${item.title}`);
    if (item.deadline !== undefined) lines.push(`  마감: ${item.deadline}`);
    lines.push(`  이유: ${recommendation.reason}`);
    lines.push(`  준비: npm start -- inbox prepare ${item.id}`);
  }

  return lines.join("\n");
}
