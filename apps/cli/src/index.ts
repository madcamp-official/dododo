import { runAdd } from "./commands/add.ts";
import { runAdvise } from "./commands/advise.ts";
import { runAsk } from "./commands/ask.ts";
import { commandCatalog } from "./commands/catalog.ts";
import { renderDoctor } from "./commands/doctor.ts";
import { renderHelp } from "./commands/help.ts";
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

  // SQLite를 열었으면(DODODO_DB_PATH 설정) 명령이 어떻게 끝나든(정상·오류·watch의
  // SIGINT 종료 전부) 파일 잠금을 풀어야 다음 실행이 곧바로 붙을 수 있다.
  try {
    if (command === "doctor") {
      const doctorArgs = process.argv.slice(3);
      const unknown = doctorArgs.filter((arg) => arg !== "--llm-test");
      if (unknown.length > 0) {
        console.error(`알 수 없는 doctor 옵션입니다: ${unknown.join(", ")}`);
        console.error("사용법: npm start -- doctor [--llm-test]");
        process.exitCode = 1;
        return;
      }
      console.log(await renderDoctor(container, fetch, {
        verifyRemoteInference: doctorArgs.includes("--llm-test"),
      }));
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
    if (command === "ask") {
      console.log(await runAsk(container, process.argv.slice(3)));
      return;
    }
    if (command === "add") {
      console.log(await runAdd(container, process.argv.slice(3)));
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
  } finally {
    container.close();
  }
}

await main();
