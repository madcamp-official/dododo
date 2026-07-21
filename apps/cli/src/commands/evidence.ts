import type { CliContainer } from "../runtime/container.ts";
import type { ContextItem } from "../../../../packages/shared/src/index.ts";

const USAGE = "사용법: dododo evidence <id>";

// user-scenarios.md 시나리오 2·9: 병합된 Context가 실제로 어느 원본(사이트/이메일/LMS)에서
// 왔는지 확인하는 명령. 판단(관련도·병합·우선순위)은 전부 코드/LLM이 이미 끝낸 뒤이고,
// 여기는 listEvidenceByContextItemId(#30/#32)로 원본 근거만 그대로 보여준다 — 가공하지 않는다.
export async function runEvidence(container: CliContainer, args: string[]): Promise<string> {
  // 여러 개를 물으면 하나만 조용히 답하고 끝내는 게 제일 안 좋다(PR #44 리뷰, 김도현
  // 지적) — id 하나가 아니면 명확히 거절한다.
  const [id, ...rest] = args;
  if (id === undefined || rest.length > 0) {
    return `Context ID 하나가 필요합니다.\n${USAGE}`;
  }

  const item = await container.repository.findContextItem(id);
  if (item === undefined) {
    return [
      `해당 ID의 Context를 찾을 수 없습니다: ${id}`,
      "`npm start -- today` 또는 `npm start -- inbox`로 먼저 ID를 확인하세요.",
    ].join("\n");
  }

  const evidence = await container.repository.listEvidenceByContextItemId(id);
  if (evidence.length === 0) {
    return renderNoEvidence(item, id);
  }

  const lines = [`근거: ${item.title} (${id})`, `총 ${evidence.length}건`, ""];
  evidence.forEach((entry, index) => {
    lines.push(`${index + 1}. [${entry.sourceType} · ${entry.authority}] ${entry.observedAt}`);
    lines.push(`   위치: ${entry.location}`);
    // #42 이후 Evidence.quote가 여러 줄일 수 있다(구조화 값으로 대체된 제목·마감의
    // 출처를 인용문 뒤에 붙임). 둘째 줄부터 들여쓰기가 없으면 왼쪽 끝으로 튀어나오고,
    // 근거가 2건 이상이면 어느 항목 소속인지도 흐려진다(PR #44 리뷰, 김도현 지적).
    lines.push(`   인용: ${entry.quote.replaceAll("\n", "\n         ")}`);
  });

  return lines.join("\n");
}

// AGENTS.md: 자동 생성 ContextItem은 반드시 추적 가능한 Evidence를 가진다 — 그러니
// 자동 생성 항목의 근거가 0건이면 정상 상태가 아니라 버그 신호다. 유일하게 정상인
// 예외는 add.ts가 만든 자연어 일정이다(원본 RawItem 자체가 없어 evidenceIds가
// 처음부터 []) — 그 경우만 "직접 추가"로 안내하고, 그 외엔 doctor로 유도한다
// (PR #44 리뷰, 김도현 지적).
function renderNoEvidence(item: ContextItem, id: string): string {
  if (item.metadata.addedViaNaturalLanguage === true) {
    return `${item.title} (${id})은 직접 추가한 항목이라 원본 근거가 없습니다.`;
  }
  return [
    `${item.title} (${id})의 근거를 찾을 수 없습니다.`,
    "자동 생성 항목인데 근거가 없으면 정상이 아닙니다 — `npm start -- doctor`로 Source 수집 상태를 확인하세요.",
  ].join("\n");
}
