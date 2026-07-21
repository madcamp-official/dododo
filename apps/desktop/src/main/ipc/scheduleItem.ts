import type { ContextItem } from "../../../../../packages/shared/src/index.ts";
import type { CliContainer } from "../../../../cli/src/runtime/container.ts";
import { renderIdLookupFailure, resolveContextItemId } from "../../../../cli/src/runtime/resolveContextItemId.ts";
import { combineLocalDateTime } from "./add.ts";
import { fail, ok, toResult, type Result } from "./result.ts";

export interface ScheduleItemUpdateInput {
  title: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  endTime?: string; // HH:mm
  location?: string;
}

// docs/frontend-plan.md 1.3 "일정 조회·수정"은 Task/Event 둘 다 대상이다 — Task 전용인
// task:complete/task:snooze와 달리 kind를 task|event 둘 다 허용한다. add:submit과 같은
// 이유로 자연어 파싱 없이 폼이 이미 구조화한 값을 그대로 받는다: Renderer가 task:detail로
// 채운 폼을 다시 통째로 제출하는 전체 교체 방식이다(부분 PATCH 아님).
//
// "삭제"는 ContextRepository에 delete 메서드가 없어(2.2, 계약 확장 시 공동 소유 절차
// 필요) 대신 status를 "cancelled"로 바꾸는 소프트 삭제로 구현한다 — AGENTS.md의 Evidence
// 추적 가능성 요구와도 맞는다(진짜로 지우면 근거를 잃는다). cancelled는 이미
// isExcludedContextStatus로 today/inbox/calendar에서 제외된다.
export async function updateScheduleItem(
  container: CliContainer,
  id: string,
  input: ScheduleItemUpdateInput,
  now: Date = new Date(),
): Promise<Result<void>> {
  const resolved = await resolveScheduleItem(container, id);
  if (!resolved.ok) return resolved;

  const title = input.title.trim();
  if (title === "") return fail("validation", "제목을 입력해주세요.");

  const startAt = combineLocalDateTime(input.date, input.time);
  if (startAt === undefined) return fail("validation", `날짜·시각이 올바르지 않습니다: ${input.date} ${input.time}`);

  let endAt: string | undefined;
  if (input.endTime !== undefined && input.endTime.trim() !== "") {
    endAt = combineLocalDateTime(input.date, input.endTime);
    if (endAt === undefined) return fail("validation", `종료 시각이 올바르지 않습니다: ${input.endTime}`);
    if (Date.parse(endAt) <= Date.parse(startAt)) {
      return fail("validation", "종료 시각은 시작 시각보다 뒤여야 합니다.");
    }
  }

  return toResult(async () => {
    const current = resolved.data;
    const metadata = { ...current.metadata };
    if (input.location !== undefined && input.location.trim() !== "") {
      metadata.location = input.location.trim();
    } else {
      delete metadata.location;
    }

    const updated: ContextItem = { ...current, title, startAt, metadata, updatedAt: now.toISOString() };
    if (endAt === undefined) delete updated.endAt;
    else updated.endAt = endAt;

    await container.repository.saveContextItems([updated]);
  });
}

export async function deleteScheduleItem(
  container: CliContainer,
  id: string,
  now: Date = new Date(),
): Promise<Result<void>> {
  const resolved = await resolveScheduleItem(container, id);
  if (!resolved.ok) return resolved;

  return toResult(async () => {
    const updated: ContextItem = { ...resolved.data, status: "cancelled", updatedAt: now.toISOString() };
    await container.repository.saveContextItems([updated]);
  });
}

async function resolveScheduleItem(container: CliContainer, id: string): Promise<Result<ContextItem>> {
  const lookup = await resolveContextItemId(container, id);
  if (lookup.kind !== "found") return fail("not-found", renderIdLookupFailure(id, lookup));
  if (lookup.item.kind !== "task" && lookup.item.kind !== "event") {
    return fail("validation", `${lookup.item.id}는 Task/Event가 아니라 ${lookup.item.kind}입니다.`);
  }
  return ok(lookup.item);
}
