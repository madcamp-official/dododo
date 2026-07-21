import type { ContextItem } from "../../../../packages/shared/src/index.ts";
import type { CliContainer } from "./container.ts";

export type IdLookupResult =
  | { kind: "found"; item: ContextItem }
  | { kind: "not_found" }
  | { kind: "ambiguous"; candidates: ContextItem[] };

// ID 전체(예: ctx-fact-raw-school-email-001-fixture-school-email-001-0)를 정확히
// 외워 입력하긴 어렵다. 정확히 일치하는 항목이 없으면 접두어로 후보를 찾아, 하나로
// 좁혀지면 그 항목을 그대로 쓴다. 여러 개 걸리면 조용히 하나를 골라 실행하지 않고
// 후보를 보여줘 더 길게 입력하도록 한다(AGENTS.md: 모호한 입력을 확인 없이
// 확정하지 않는다). 한두 글자 같은 너무 짧은 입력은 거의 항상 우연한 오타이지
// 의도적인 접두어가 아니므로 접두어 검색 자체를 시도하지 않는다.
const MIN_PREFIX_LENGTH = 4;

export async function resolveContextItemId(
  container: CliContainer,
  idOrPrefix: string,
): Promise<IdLookupResult> {
  const exact = await container.repository.findContextItem(idOrPrefix);
  if (exact !== undefined) return { kind: "found", item: exact };
  if (idOrPrefix.length < MIN_PREFIX_LENGTH) return { kind: "not_found" };

  const all = await container.repository.listContextItems();
  const candidates = all.filter((item) => item.id.startsWith(idOrPrefix));
  if (candidates.length === 1) return { kind: "found", item: candidates[0]! };
  if (candidates.length > 1) return { kind: "ambiguous", candidates };
  return { kind: "not_found" };
}

export function renderIdLookupFailure(
  idOrPrefix: string,
  result: { kind: "not_found" } | { kind: "ambiguous"; candidates: ContextItem[] },
): string {
  if (result.kind === "ambiguous") {
    const lines = [`'${idOrPrefix}'로 시작하는 ID가 ${result.candidates.length}개입니다. 더 길게 입력해주세요.`];
    for (const candidate of result.candidates) {
      lines.push(`  ${candidate.id}  [${candidate.kind}] ${candidate.title}`);
    }
    return lines.join("\n");
  }
  return [
    `해당 ID를 찾을 수 없습니다: ${idOrPrefix}`,
    "`npm start -- today` 또는 `npm start -- inbox`로 먼저 ID를 확인하세요.",
  ].join("\n");
}
