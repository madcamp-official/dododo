import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import { parseScheduleIntent } from "../../../../packages/context-engine/src/index.ts";
import type { ContextItem } from "../../../../packages/shared/src/index.ts";
import type { CliContainer } from "../runtime/container.ts";

const USAGE = "사용법: dododo add <자연어 일정>";

export interface AddIo {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
}

// user-scenarios.md 시나리오 6. 날짜·시각 계산은 parseScheduleIntent(코드, LLM 아님)가
// 전부 하고, 이 명령은 결과를 사용자에게 보여주고 [y/N/edit] 확인만 받는다 —
// AGENTS.md: 모호한 일정을 사용자 확인 없이 확정하지 않는다.
export async function runAdd(
  container: CliContainer,
  args: string[],
  now: Date = new Date(),
  io: AddIo = { input: stdin, output: stdout },
): Promise<string> {
  const utterance = args.join(" ").trim();
  if (utterance === "") {
    return `일정 내용을 입력해주세요.\n${USAGE}`;
  }

  const intent = parseScheduleIntent(utterance, now);
  if (intent.kind === "unrecognized") {
    return "일정 추가 의도를 알아듣지 못했습니다. 예: \"이번 주 금요일 저녁에 민수랑 저녁 약속 있어\"";
  }

  // 파이프·스크립트 등 비대화형 환경에서 stdin이 TTY가 아니면 rl.question()이 입력을
  // 영원히 기다려 프로세스가 멈춘다(PR #33 리뷰, 김도현 지적). 기본 stdin을 그대로 쓰는
  // 경우에만 검사한다 — 테스트가 주입하는 스크립트 스트림(io.input !== stdin)은 그대로 둔다.
  if (io.input === stdin && stdin.isTTY !== true) {
    return `${intent.clarifyingQuestion}\n비대화형 환경이라 자동으로 저장하지 않습니다. 대화형 터미널에서 다시 실행해 확인해주세요.`;
  }

  const rl = createInterface({ input: io.input, output: io.output });
  let rawAnswer: string;
  try {
    rawAnswer = await rl.question(`${intent.clarifyingQuestion} `);
  } finally {
    rl.close();
  }

  const answer = rawAnswer.trim().toLowerCase();
  if (answer === "edit") {
    return "다시 `dododo add <내용>`으로 정확한 표현을 입력해주세요.";
  }
  if (answer !== "y" && answer !== "yes") {
    return "일정 추가를 취소했습니다.";
  }

  const event: ContextItem = {
    id: `ctx-add-${randomUUID()}`,
    kind: "event",
    title: intent.title,
    status: "confirmed",
    startAt: intent.startAt,
    requirements: [],
    tags: [],
    priority: 0,
    confidence: 1,
    evidenceIds: [],
    metadata: { evidenceQuote: intent.evidenceQuote, addedViaNaturalLanguage: true },
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  await container.repository.saveContextItems([event]);

  return `일정을 저장했습니다: ${intent.title} (${intent.startAt})`;
}
