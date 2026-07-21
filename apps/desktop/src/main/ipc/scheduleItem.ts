import type { ContextItem } from "../../../../../packages/shared/src/index.ts";
import type { CliContainer } from "../../../../cli/src/runtime/container.ts";
import { renderIdLookupFailure, resolveContextItemId } from "../../../../cli/src/runtime/resolveContextItemId.ts";
import { combineLocalDateTime } from "./add.ts";
import { fail, ok, toResult, type Result } from "./result.ts";
import { isValidOffsetMinutes } from "./validate.ts";

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
  const current = resolved.data;
  const isTask = current.kind === "task";

  const title = input.title.trim();
  if (title === "") return fail("validation", "제목을 입력해주세요.");

  const combined = combineLocalDateTime(input.date, input.time);
  if (combined === undefined) return fail("validation", `날짜·시각이 올바르지 않습니다: ${input.date} ${input.time}`);

  // doyeonid 리뷰(PR #64): calendar.ts(scheduledValue)와 priority.ts(deadline ?? startAt)는
  // event는 startAt/endAt, task는 deadline 하나만 읽는다 — Task 수정에서도 종류별로
  // 다른 필드에 써야 캘린더·우선순위가 실제로 갱신된다. Task는 마감 하나뿐이라
  // endTime을 아예 받지 않는다(구간 개념이 없음을 명확히 한다).
  if (isTask && input.endTime !== undefined && input.endTime.trim() !== "") {
    return fail("validation", "Task는 종료 시각(endTime)을 가질 수 없습니다 — 마감(deadline) 하나만 있습니다.");
  }

  let endAt: string | undefined;
  if (!isTask && input.endTime !== undefined && input.endTime.trim() !== "") {
    endAt = combineLocalDateTime(input.date, input.endTime);
    if (endAt === undefined) return fail("validation", `종료 시각이 올바르지 않습니다: ${input.endTime}`);
    if (Date.parse(endAt) <= Date.parse(combined)) {
      return fail("validation", "종료 시각은 시작 시각보다 뒤여야 합니다.");
    }
  }

  return toResult(async () => {
    const metadata = { ...current.metadata };
    if (input.location !== undefined && input.location.trim() !== "") {
      metadata.location = input.location.trim();
    } else {
      delete metadata.location;
    }

    const updated: ContextItem = { ...current, title, metadata, updatedAt: now.toISOString() };
    if (isTask) {
      updated.deadline = combined;
      delete updated.startAt;
      delete updated.endAt;
    } else {
      updated.startAt = combined;
      if (endAt === undefined) delete updated.endAt;
      else updated.endAt = endAt;
      // 김도현 리뷰(PR #64): Task 쪽은 반대 필드(startAt/endAt)를 정리하는데 Event
      // 쪽만 deadline을 안 건드리면 비대칭이다 — 지금은 Event가 deadline을 갖는
      // 경로가 없어 버그는 아니지만, 나중에 실수로 채워지는 경로가 생겨도
      // scheduledValue/deadlineUrgencyScore가 deadline을 그대로 읽지 않도록 미리 지운다.
      delete updated.deadline;
    }

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

// docs/frontend-plan.md 1.5/2.4: 상세 패널의 "알림 시간 수정" 진입점. 오프셋은
// reminderCheck.ts와 같은 metadata 키(reminderOffsetMinutes)를 쓴다 — add:submit이
// 새 항목 생성 시 이미 같은 키에 쓰고 있다.
export async function setReminderOffset(
  container: CliContainer,
  id: string,
  offsetMinutes: number,
  now: Date = new Date(),
): Promise<Result<void>> {
  const resolved = await resolveScheduleItem(container, id);
  if (!resolved.ok) return resolved;

  if (!isValidOffsetMinutes(offsetMinutes)) {
    return fail("validation", `리마인더 오프셋은 0 이상의 정수(분)여야 합니다: ${offsetMinutes}`);
  }

  return toResult(async () => {
    const current = resolved.data;
    const updated: ContextItem = {
      ...current,
      metadata: { ...current.metadata, reminderOffsetMinutes: offsetMinutes },
      updatedAt: now.toISOString(),
    };
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
