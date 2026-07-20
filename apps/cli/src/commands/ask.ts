import { answerContextQuestion } from "../../../../packages/context-engine/src/index.ts";
import type { CliContainer } from "../runtime/container.ts";

const USAGE = "사용법: dododo ask <질문>";

// user-scenarios.md 시나리오 7. 근거 선정(관련도+마감 임박도 랭킹)은 answerContextQuestion이
// 코드로 하고, LLM은 문장 표현만 맡는다(provider 없으면 결정론적 템플릿으로 폴백).
export async function runAsk(
  container: CliContainer,
  args: string[],
  now: Date = new Date(),
): Promise<string> {
  const question = args.join(" ").trim();
  if (question === "") {
    return `질문을 입력해주세요.\n${USAGE}`;
  }

  const items = await container.repository.listContextItems();
  const result = await answerContextQuestion(
    question,
    items,
    now,
    container.llmProvider,
    container.privacyGateway,
  );

  const lines = [result.answer];
  if (result.evidenceIds.length > 0) {
    lines.push(`근거: ${result.evidenceIds.join(", ")}`);
  }
  return lines.join("\n");
}
