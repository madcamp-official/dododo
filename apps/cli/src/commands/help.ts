import { commandCatalog } from "./catalog.ts";

export function renderHelp(): string {
  const rows = commandCatalog.map((command) => {
    const suffix = command.status === "ready" ? "" : " [skeleton]";
    return `  ${command.name.padEnd(10)} ${command.description}${suffix}`;
  });

  return [
    "dododo — Local-first Context Assistant",
    "",
    "Usage: npm start -- <command>",
    "",
    "Commands:",
    ...rows,
  ].join("\n");
}
