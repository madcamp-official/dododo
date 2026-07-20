import type { ContextItem } from "../../../shared/src/index.ts";
import type { JSONSchemaNode } from "../llm/jsonSchema.ts";
import type { LLMProvider } from "../llm/provider.ts";
import { trigramSimilarity } from "../resolution/similarity.ts";

export interface ContextAnswer {
  answer: string;
  evidenceIds: string[];
}

// 어떤 항목이 답변의 근거가 될지는 코드가 정하고(관련도 + 마감 임박도 랭킹), LLM은
// 고른 근거를 자연어 문장으로만 표현한다. LLM이 무엇이 중요한지 스스로 고르지 않게 한다
// (README 핵심 가설). 관련 항목이 없으면 지어내지 않고 "모른다"를 명시한다.
const EXCLUDED_STATUSES = new Set(["done", "cancelled", "dismissed", "expired"]);
const TOP_N = 2;

const answerSchema: JSONSchemaNode = {
  type: "object",
  required: ["answer"],
  properties: { answer: { type: "string" } },
};

interface AnswerResponse {
  answer: string;
}

function isAnswerResponse(value: unknown): value is AnswerResponse {
  return typeof value === "object" && value !== null && typeof (value as AnswerResponse).answer === "string";
}

export async function answerContextQuestion(
  question: string,
  items: ContextItem[],
  now: Date,
  provider?: LLMProvider,
): Promise<ContextAnswer> {
  const ranked = rankCandidates(question, items, now);

  if (ranked.length === 0) {
    return { answer: "관련 정보를 찾지 못했습니다.", evidenceIds: [] };
  }

  const chosen = ranked.slice(0, TOP_N);
  const evidenceIds = [...new Set(chosen.flatMap((item) => item.evidenceIds))];

  if (provider === undefined) {
    return { answer: templateAnswer(chosen[0]!), evidenceIds };
  }

  try {
    const response = await provider.completeJSON({
      modelKind: "text",
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: buildUserPrompt(question, chosen, now),
      schema: answerSchema,
      validate: isAnswerResponse,
    });
    return { answer: response.answer, evidenceIds };
  } catch {
    return { answer: templateAnswer(chosen[0]!), evidenceIds };
  }
}

// 미완료 항목만 대상으로, 질문과의 관련도(제목·태그 trigram)와 마감 임박도를 합쳐
// 순위를 매긴다. 마감이 임박한 미완료 Task를 우선한다(시나리오 7).
function rankCandidates(question: string, items: ContextItem[], now: Date): ContextItem[] {
  return items
    .filter((item) => !EXCLUDED_STATUSES.has(item.status) && !isSnoozed(item, now))
    .map((item) => ({ item, score: questionScore(question, item, now) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.item);
}

function questionScore(question: string, item: ContextItem, now: Date): number {
  const relevance = Math.max(
    trigramSimilarity(question, item.title),
    ...item.tags.map((tag) => trigramSimilarity(question, tag)),
  );
  const urgency = deadlineUrgency(item.deadline, now);
  // 미완료 Task/Event/Opportunity는 관련도가 낮아도 마감 임박이면 후보가 되도록,
  // 관련도와 임박도 중 큰 값을 기본 점수로 쓰고 나머지를 보너스로 더한다.
  return Math.max(relevance, urgency) + Math.min(relevance, urgency) * 0.5;
}

function deadlineUrgency(deadline: string | undefined, now: Date): number {
  if (deadline === undefined) return 0.1; // 마감 없는 미완료 항목도 최소한의 후보 자격은 준다.
  const ms = Date.parse(deadline);
  if (Number.isNaN(ms)) return 0.1;
  const hoursLeft = (ms - now.getTime()) / (1000 * 60 * 60);
  if (hoursLeft <= 0) return 1;
  if (hoursLeft >= 168) return 0.1;
  return 1 - (hoursLeft / 168) * 0.9;
}

const SYSTEM_PROMPT = [
  "당신은 대학생의 로컬 Context를 근거로 질문에 답하는 보조자입니다.",
  "아래 <candidates>는 코드가 이미 관련도·마감 임박도로 골라 준 근거입니다.",
  "이 근거에 있는 사실만 사용하고, 없는 마감이나 요구사항을 지어내지 마세요.",
  "가장 먼저 할 일을 구체적으로 한두 문장으로 제안하고, 그 이유(마감·미완료 요구사항)를 덧붙이세요.",
].join("\n");

function buildUserPrompt(question: string, chosen: ContextItem[], now: Date): string {
  const lines = [`질문: ${question}`, `현재 시각: ${now.toISOString()}`, "<candidates>"];
  for (const item of chosen) {
    lines.push(`- ${item.title}`
      + (item.deadline !== undefined ? ` | 마감: ${item.deadline}` : "")
      + (item.requirements.length > 0 ? ` | 미완료 요구사항: ${item.requirements.join(", ")}` : ""));
  }
  lines.push("</candidates>");
  return lines.join("\n");
}

function templateAnswer(item: ContextItem): string {
  const reason = item.deadline !== undefined ? ` 마감이 ${item.deadline}입니다.` : "";
  return `${item.title}을(를) 먼저 하세요.${reason}`;
}

const SNOOZED_UNTIL_KEY = "snoozedUntil";

function isSnoozed(item: ContextItem, now: Date): boolean {
  const value = item.metadata[SNOOZED_UNTIL_KEY];
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) && new Date(value) > now;
}
