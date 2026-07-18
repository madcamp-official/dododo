import type { CliContainer } from "../runtime/container.ts";
import { renderSourceStatus } from "../runtime/sourceStatus.ts";
import { commandCatalog } from "./catalog.ts";

export function renderDoctor(container: CliContainer): string {
  const ready = commandCatalog.filter((command) => command.status === "ready").length;
  const skeleton = commandCatalog.length - ready;

  return [
    "dododo doctor",
    `Node: ${process.version}`,
    `Runtime: ${process.platform}/${process.arch}`,
    `Commands: ${ready} ready, ${skeleton} skeleton`,
    "Storage: in-memory scaffold (SQLite pending)",
    "LLM: provider adapter pending (임시 휴리스틱 FactExtractor 사용 중)",
    "",
    renderSourceStatus(container),
  ].join("\n");
}
