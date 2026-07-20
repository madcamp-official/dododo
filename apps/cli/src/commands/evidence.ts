import type { CliContainer } from "../runtime/container.ts";

const USAGE = "사용법: dododo evidence <id>";

// user-scenarios.md 시나리오 2·9: 병합된 Context가 실제로 어느 원본(사이트/이메일/LMS)에서
// 왔는지 확인하는 명령. 판단(관련도·병합·우선순위)은 전부 코드/LLM이 이미 끝낸 뒤이고,
// 여기는 listEvidenceByContextItemId(#30/#32)로 원본 근거만 그대로 보여준다 — 가공하지 않는다.
export async function runEvidence(container: CliContainer, args: string[]): Promise<string> {
  const [id] = args;
  if (id === undefined) {
    return `Context ID가 필요합니다.\n${USAGE}`;
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
    return `${item.title} (${id})의 근거를 찾을 수 없습니다. Evidence가 아직 연결되지 않았을 수 있습니다.`;
  }

  const lines = [`근거: ${item.title} (${id})`, `총 ${evidence.length}건`, ""];
  evidence.forEach((entry, index) => {
    lines.push(`${index + 1}. [${entry.sourceType} · ${entry.authority}] ${entry.observedAt}`);
    lines.push(`   위치: ${entry.location}`);
    lines.push(`   인용: ${entry.quote}`);
  });

  return lines.join("\n");
}
