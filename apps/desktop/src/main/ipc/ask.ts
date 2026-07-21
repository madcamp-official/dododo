import { answerContextQuestion } from "../../../../../packages/context-engine/src/index.ts";
import type { CliContainer } from "../../../../cli/src/runtime/container.ts";
import { fail, toResult, type Result } from "./result.ts";

export interface AskAnswer {
  answer: string;
  evidenceIds: string[];
}

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
    return { answer: result.answer, evidenceIds: result.evidenceIds };
  });
}
