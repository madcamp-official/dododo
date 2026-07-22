import type { CliContainer } from "../runtime/container.ts";
import { rankItems } from "../runtime/recommendationRanking.ts";
import { renderIdLookupFailure, resolveContextItemId } from "../runtime/resolveContextItemId.ts";
import {
  isExcludedContextStatus,
  prepareOpportunity,
} from "../../../../packages/context-engine/src/index.ts";

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
  const items = await container.repository.listContextItems("opportunity");

  if (items.length === 0) {
    return [
      "Opportunity Inbox",
      "",
      "등록된 Opportunity가 없습니다. `npm start -- sync`를 먼저 실행하세요.",
    ].join("\n");
  }

  const ranked = await rankItems(container, items, now);

  const lines = ["Opportunity Inbox", ""];
  for (const { item, score, reason } of ranked) {
    lines.push(`[${item.id}] 관련도 ${Math.round(score)}  ${item.title}`);
    if (item.deadline !== undefined) lines.push(`  마감: ${item.deadline}`);
    if (reason.length > 0) lines.push(`  이유: ${reason}`);
    lines.push(`  준비: npm start -- inbox prepare ${item.id}`);
  }

  return lines.join("\n");
}
