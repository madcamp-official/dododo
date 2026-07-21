import type { CliContainer } from "../../../../cli/src/runtime/container.ts";
import { listInboxEntries, type RecommendedEntry } from "../../../../cli/src/commands/inbox.ts";
import { runResult, type Result } from "./result.ts";

export interface InboxGetResponse {
  entries: RecommendedEntry[];
}

export async function getInbox(container: CliContainer, now: Date = new Date()): Promise<Result<InboxGetResponse>> {
  return runResult(async () => {
    const { entries } = await listInboxEntries(container, now);
    return { entries };
  });
}
