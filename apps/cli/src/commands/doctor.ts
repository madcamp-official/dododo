import { commandCatalog } from "./catalog.ts";

export function renderDoctor(): string {
  const ready = commandCatalog.filter((command) => command.status === "ready").length;
  const skeleton = commandCatalog.length - ready;

  return [
    "dododo doctor",
    `Node: ${process.version}`,
    `Runtime: ${process.platform}/${process.arch}`,
    `Commands: ${ready} ready, ${skeleton} skeleton`,
    "Storage: in-memory scaffold (SQLite pending)",
    "LLM: provider adapter pending",
  ].join("\n");
}
