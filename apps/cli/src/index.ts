import { commandCatalog } from "./commands/catalog.ts";
import { renderDoctor } from "./commands/doctor.ts";
import { renderHelp } from "./commands/help.ts";
import { runAdvise } from "./commands/advise.ts";
import { renderInbox } from "./commands/inbox.ts";
import { runSetup } from "./commands/setup.ts";
import { runSync } from "./commands/sync.ts";
import { runScreen } from "./commands/screen.ts";
import { runTask } from "./commands/task.ts";
import { renderToday } from "./commands/today.ts";
import { runWatch } from "./commands/watch.ts";
import { createCliContainer } from "./runtime/container.ts";

const command = process.argv[2] ?? "help";

async function main(): Promise<void> {
  if (command === "help" || command === "--help" || command === "-h") {
    console.log(renderHelp());
    return;
  }

  const container = createCliContainer();

  if (command === "doctor") {
    console.log(renderDoctor(container));
    return;
  }
  if (command === "setup") {
    console.log(await runSetup(container));
    return;
  }
  if (command === "sync") {
    console.log(await runSync(container));
    return;
  }
  if (command === "inbox") {
    console.log(await renderInbox(container));
    return;
  }
  if (command === "today") {
    console.log(await renderToday(container));
    return;
  }
  if (command === "task") {
    console.log(await runTask(container, process.argv.slice(3)));
    return;
  }
  if (command === "watch") {
    console.log(await runWatch(container, process.argv.slice(3)));
    return;
  }
  if (command === "screen") {
    console.log(await runScreen(container));
    return;
  }
  if (command === "advise") {
    console.log(await runAdvise(container, process.argv.slice(3)));
    return;
  }

  const definition = commandCatalog.find((candidate) => candidate.name === command);

  if (definition === undefined) {
    console.error(`알 수 없는 명령입니다: ${command}`);
    console.error("사용 가능한 명령은 `npm start -- help`로 확인하세요.");
    process.exitCode = 1;
  } else {
    console.log(`${definition.name}: 스켈레톤만 생성된 명령입니다.`);
    console.log(`담당 영역: ${definition.owner}`);
  }
}

await main();
