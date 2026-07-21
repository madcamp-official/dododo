import type { Evidence } from "../../../../../packages/shared/src/index.ts";
import { answerContextQuestion } from "../../../../../packages/context-engine/src/index.ts";
import type { CliContainer } from "../../../../cli/src/runtime/container.ts";
import { fail, toResult, type Result } from "./result.ts";

export interface AskAnswer {
  answer: string;
  evidenceIds: string[];
  evidence: Evidence[];
}

// docs/frontend-plan.md 6.1: task:detail과 같은 이유로 evidenceIds뿐 아니라 Evidence
// 본문도 함께 돌려준다 — Renderer가 답변 옆에 근거 원문을 바로 보여줄 수 있게 한다
// (evidenceIds는 하위 호환을 위해 그대로 유지).
export async function askQuestion(
  container: CliContainer,
  question: string,
  now: Date = new Date(),
): Promise<Result<AskAnswer>> {
  const trimmed = question.trim();
  if (trimmed === "") return fail("validation", "질문을 입력해주세요.");

  return toResult(async () => {
    const items = await container.repository.listContextItems();
    const result = await answerContextQuestion(
      trimmed,
      items,
      now,
      container.llmProvider,
      container.privacyGateway,
    );
    const evidence = await container.repository.listEvidence(result.evidenceIds);
    return { answer: result.answer, evidenceIds: result.evidenceIds, evidence };
  });
}
