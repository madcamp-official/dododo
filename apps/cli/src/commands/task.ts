import type { ContextItem } from "../../../../packages/shared/src/index.ts";
import type { CliContainer } from "../runtime/container.ts";
import { isSnoozed, snoozedUntil, withSnooze } from "../runtime/snooze.ts";

const USAGE = "사용법: dododo task <show|done|snooze> <id> [--until <ISO 시각>]";

export async function runTask(
  container: CliContainer,
  args: string[],
  now: Date = new Date(),
): Promise<string> {
  const [subcommand, id, ...rest] = args;

  if (subcommand === undefined) {
    return `Task 서브커맨드가 필요합니다.\n${USAGE}`;
  }
  if (subcommand !== "show" && subcommand !== "done" && subcommand !== "snooze") {
    return `알 수 없는 task 서브커맨드입니다: ${subcommand}\n${USAGE}`;
  }
  if (id === undefined) {
    return `Task ID가 필요합니다.\n사용법: dododo task ${subcommand} <id>`;
  }

  const item = await container.repository.findContextItem(id);
  if (item === undefined) {
    return [
      `해당 ID의 Task를 찾을 수 없습니다: ${id}`,
      "`npm start -- today` 또는 `npm start -- inbox`로 먼저 ID를 확인하세요.",
    ].join("\n");
  }
  if (item.kind !== "task") {
    return `${id}는 Task가 아니라 ${item.kind}입니다. \`dododo task\`는 Task에만 사용할 수 있습니다.`;
  }

  if (subcommand === "show") {
    return renderTaskDetail(item, now);
  }

  if (subcommand === "done") {
    const updated: ContextItem = { ...item, status: "done", updatedAt: now.toISOString() };
    await container.repository.saveContextItems([updated]);
    return `Task를 완료 처리했습니다: ${item.title} (${item.id})`;
  }

  const raw = findUntilFlagValue(rest);
  if (raw === undefined) {
    return "Snooze하려면 --until <ISO 시각>이 필요합니다. 예: --until 2026-07-25T00:00:00+09:00";
  }
  const untilMs = Date.parse(raw);
  if (Number.isNaN(untilMs)) {
    return `'${raw}'는 올바른 시각이 아닙니다. ISO 8601 형식을 사용하세요(예: 2026-07-25T00:00:00+09:00).`;
  }

  const until = new Date(untilMs);
  const updated: ContextItem = { ...withSnooze(item, until), updatedAt: now.toISOString() };
  await container.repository.saveContextItems([updated]);
  return `Task를 ${until.toISOString()}까지 Snooze했습니다: ${item.title} (${item.id})`;
}

function findUntilFlagValue(args: string[]): string | undefined {
  const flagIndex = args.indexOf("--until");
  if (flagIndex === -1) return undefined;
  return args[flagIndex + 1];
}

function renderTaskDetail(item: ContextItem, now: Date): string {
  const lines = ["Task 상세", "", `제목: ${item.title}`, `ID: ${item.id}`, `상태: ${item.status}`];

  if (item.deadline !== undefined) lines.push(`마감: ${item.deadline}`);

  lines.push(`요구사항: ${item.requirements.length > 0 ? item.requirements.join(", ") : "(없음)"}`);
  lines.push(
    `근거: ${item.evidenceIds.length > 0 ? item.evidenceIds.join(", ") : "근거 없음(Evidence 연결 대기)"}`,
  );

  const snoozeValue = snoozedUntil(item);
  if (snoozeValue === undefined) {
    lines.push("Snooze: 미설정");
  } else {
    lines.push(
      isSnoozed(item, now)
        ? `Snooze: ${snoozeValue}까지 숨김`
        : `Snooze: ${snoozeValue}(만료됨, 다시 표시됨)`,
    );
  }

  return lines.join("\n");
}
