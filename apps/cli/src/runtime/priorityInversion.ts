import type { ContextItem } from "../../../../packages/shared/src/index.ts";
import type { CliContainer } from "./container.ts";
import { rankItems, type RankedItem } from "./recommendationRanking.ts";

export interface PriorityInversion {
  currentItem: ContextItem;
  currentScore: number;
  topItem: ContextItem;
  topScore: number;
}

// docs/frontend-plan.md 2.1: 현재 세션/화면에서 다루는 Task보다 전체 순위상 더
// 급한 Task가 있으면 알린다. "현재 다루는 Task"가 무엇인지(세션 상태, 또는 아직
// 미구현인 Vision 화면 Activity 연결)는 호출부가 정해 currentItemId로 넘긴다 —
// 이 함수는 이미 점수가 계산된 목록과 그 id를 비교하는 순수 판정만 담당한다.
// 호출자가 목록을 정렬했다고 가정하지 않고 실제 최고 점수를 직접 찾는다.
export function findPriorityInversion(
  ranked: RankedItem[],
  currentItemId: string,
): PriorityInversion | undefined {
  if (ranked.length === 0) return undefined;

  const current = ranked.find(({ item }) => item.id === currentItemId);
  // 현재 항목이 순위 목록에 없으면(완료·Snooze 등으로 제외됐거나 존재하지 않는
  // id) 비교 기준이 없어 판정하지 않는다.
  if (current === undefined) return undefined;

  const top = ranked.reduce((highest, candidate) => (
    candidate.score > highest.score ? candidate : highest
  ));
  if (top.score <= current.score) return undefined;

  return {
    currentItem: current.item,
    currentScore: current.score,
    topItem: top.item,
    topScore: top.score,
  };
}

// rankItems(container 기반 실제 순위 계산)와 findPriorityInversion(순수 비교)을
// 묶은 조합 함수 — IPC 핸들러가 container 배선을 반복하지 않고 바로 쓸 수 있다.
// getToday(apps/desktop/src/main/ipc/context.ts)와 같은 풀(task+event)을 쓴다 —
// "지금 하는 일보다 오늘 목록에 더 급한 게 있는가"라는 같은 질문이기 때문이다.
export async function checkPriorityInversion(
  container: CliContainer,
  currentItemId: string,
  now: Date,
): Promise<PriorityInversion | undefined> {
  const tasks = await container.repository.listContextItems("task");
  const events = await container.repository.listContextItems("event");
  const ranked = await rankItems(container, [...tasks, ...events], now);
  return findPriorityInversion(ranked, currentItemId);
}
