// 외부 LLM에는 "목적에 필요한 최소 범위"만 전달한다(AGENTS.md). 원문 전체를 보내는
// 대신, 마감·요구사항 신호가 밀집한 문단만 골라 문자 예산 안으로 줄인다.

export interface ChunkingOptions {
  // 선택된 Chunk를 이어붙인 최종 길이의 상한(문자 수). 기본 2000자.
  maxChars?: number;
  // 이 점수 미만인 문단만 있으면 신호가 약한 것으로 보고, 첫 문단과 title 포함 문단만
  // 보존한다.
  minScore?: number;
  // 제목이 들어간 문단은 신호가 약해도 보존한다.
  title?: string;
}

const DEFAULT_MAX_CHARS = 2000;
const DEFAULT_MIN_SCORE = 1;

const DATE_PATTERN = /\d{4}[-.년/]\s*\d{1,2}[-.월/]\s*\d{1,2}/g;
const TIME_PATTERN = /\d{1,2}\s*[:시]\s*\d{0,2}/g;
const KEYWORD_PATTERN = /(마감|제출|신청|접수|요구사항|자격|기한|모집|지원)/g;

export function selectRelevantContent(content: string, options: ChunkingOptions = {}): string {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const minScore = options.minScore ?? DEFAULT_MIN_SCORE;

  const paragraphs = splitIntoParagraphs(content);
  if (paragraphs.length === 0) return "";

  // 이미 예산 안이면 그대로 둔다 — 짧은 Fixture나 짧은 공지는 손대지 않는다.
  if (content.length <= maxChars) return content;

  const scored = paragraphs.map((text, index) => ({ text, index, score: scoreParagraph(text) }));
  const hasStrongSignal = scored.some((paragraph) => paragraph.score >= minScore);

  const selected = hasStrongSignal
    ? pickByScore(scored, maxChars, minScore)
    : pickFallback(scored, options.title);

  // 원래 문단 순서를 유지해 맥락이 뒤섞이지 않게 한다.
  return selected
    .sort((a, b) => a.index - b.index)
    .map((paragraph) => paragraph.text)
    .join("\n\n");
}

interface ScoredParagraph {
  text: string;
  index: number;
  score: number;
}

function splitIntoParagraphs(content: string): string[] {
  const byBlankLine = content
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (byBlankLine.length > 1) return byBlankLine;

  // 빈 줄이 없으면 줄 단위로, 그것도 한 줄이면 문장 단위로 나눈다.
  const byLine = content.split(/\n/).map((line) => line.trim()).filter((line) => line.length > 0);
  if (byLine.length > 1) return byLine;

  return content
    .split(/(?<=[.!?。])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

function scoreParagraph(text: string): number {
  return countMatches(text, DATE_PATTERN)
    + countMatches(text, TIME_PATTERN)
    + countMatches(text, KEYWORD_PATTERN);
}

function countMatches(text: string, pattern: RegExp): number {
  return (text.match(pattern) ?? []).length;
}

// 점수 높은 문단부터 예산이 허용하는 만큼 채택한다.
function pickByScore(scored: ScoredParagraph[], maxChars: number, minScore: number): ScoredParagraph[] {
  const candidates = [...scored]
    .filter((paragraph) => paragraph.score >= minScore)
    .sort((a, b) => b.score - a.score);

  const selected: ScoredParagraph[] = [];
  let used = 0;
  for (const paragraph of candidates) {
    const added = paragraph.text.length + (selected.length > 0 ? 2 : 0);
    if (used + added > maxChars) continue;
    selected.push(paragraph);
    used += added;
  }

  // 예산이 너무 작아 아무것도 못 담았다면 최고 점수 문단 하나만이라도 넣는다.
  if (selected.length === 0 && candidates.length > 0) selected.push(candidates[0]!);
  return selected;
}

// 신호가 약할 때: 첫 문단과 제목을 포함한 문단만 남긴다.
function pickFallback(scored: ScoredParagraph[], title: string | undefined): ScoredParagraph[] {
  const selected = new Map<number, ScoredParagraph>();
  if (scored.length > 0) selected.set(scored[0]!.index, scored[0]!);

  const normalizedTitle = title?.trim();
  if (normalizedTitle !== undefined && normalizedTitle.length > 0) {
    for (const paragraph of scored) {
      if (paragraph.text.includes(normalizedTitle)) selected.set(paragraph.index, paragraph);
    }
  }

  return [...selected.values()];
}
