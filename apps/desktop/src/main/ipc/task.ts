import type { ContextItem, Evidence } from "../../../../../packages/shared/src/index.ts";
import type { CliContainer } from "../../../../cli/src/runtime/container.ts";
import { renderIdLookupFailure, resolveContextItemId } from "../../../../cli/src/runtime/resolveContextItemId.ts";
import { isSnoozed, snoozedUntil, withSnooze } from "../../../../cli/src/runtime/snooze.ts";
import { fail, ok, toResult, type Result } from "./result.ts";

export interface TaskDetail {
  item: ContextItem;
  evidence: Evidence[];
  snoozedUntil: string | undefined;
  isSnoozed: boolean;
}

// docs/frontend-plan.md 1.5 상세보기 패널: task.ts(show)와 evidence.ts가 각각 텍스트로
// 하던 걸 한 번의 조회로 합쳐 반환한다 — Renderer가 상세 패널 하나를 그리는 데
// 왕복 두 번 필요 없게 한다.
export async function getTaskDetail(
  container: CliContainer,
  id: string,
  now: Date = new Date(),
): Promise<Result<TaskDetail>> {
  const lookup = await resolveContextItemId(container, id);
  if (lookup.kind !== "found") return fail("not-found", renderIdLookupFailure(id, lookup));

  const item = lookup.item;
  return toResult(async () => {
    const evidence = await container.repository.listEvidenceByContextItemId(item.id);
    return {
      item,
      evidence,
      snoozedUntil: snoozedUntil(item),
      isSnoozed: isSnoozed(item, now),
    };
  });
}

export async function completeTask(
  container: CliContainer,
  id: string,
  now: Date = new Date(),
): Promise<Result<void>> {
  const validated = await resolveTask(container, id);
  if (!validated.ok) return validated;

  return toResult(async () => {
    const updated: ContextItem = { ...validated.data, status: "done", updatedAt: now.toISOString() };
    await container.repository.saveContextItems([updated]);
  });
}

export async function snoozeTask(
  container: CliContainer,
  id: string,
  until: string,
  now: Date = new Date(),
): Promise<Result<void>> {
  const validated = await resolveTask(container, id);
  if (!validated.ok) return validated;

  const untilMs = Date.parse(until);
  if (Number.isNaN(untilMs)) return fail("validation", `'${until}'는 올바른 시각이 아닙니다(ISO 8601 형식 필요).`);

  return toResult(async () => {
    const updated: ContextItem = { ...withSnooze(validated.data, new Date(untilMs)), updatedAt: now.toISOString() };
    await container.repository.saveContextItems([updated]);
  });
}

// task 액션 두 곳(완료·Snooze) 모두 "ID를 찾고, Task kind인지 확인"이 먼저 필요하다 —
// task.ts(CLI)가 하는 것과 같은 순서다.
async function resolveTask(container: CliContainer, id: string): Promise<Result<ContextItem>> {
  const lookup = await resolveContextItemId(container, id);
  if (lookup.kind !== "found") return fail("not-found", renderIdLookupFailure(id, lookup));
  if (lookup.item.kind !== "task") {
    return fail("validation", `${lookup.item.id}는 Task가 아니라 ${lookup.item.kind}입니다.`);
  }
  return ok(lookup.item);
}
