import type { CliContainer } from "../../../../cli/src/runtime/container.ts";
import { answerContextQuestion } from "../../../../../packages/context-engine/src/index.ts";
import { fail, ok, type Result } from "./result.ts";

export interface AskAskRequest {
  question: string;
}

export interface AskAskResponse {
  answer: string;
  evidenceIds: string[];
}

export async function askQuestion(
  container: CliContainer,
  input: AskAskRequest,
  now: Date = new Date(),
): Promise<Result<AskAskResponse>> {
  const question = input.question.trim();
  if (question === "") return fail("validation", "질문을 입력해주세요.");

  try {
    const items = await container.repository.listContextItems();
    const result = await answerContextQuestion(
      question,
      items,
      now,
      container.llmProvider,
      container.privacyGateway,
    );
    return ok(result);
  } catch (error) {
    return fail("unknown", error instanceof Error ? error.message : String(error));
  }
}
