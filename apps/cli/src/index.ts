import { commandCatalog } from "./commands/catalog.ts";
import { renderDoctor } from "./commands/doctor.ts";
import { renderHelp } from "./commands/help.ts";

const command = process.argv[2] ?? "help";

if (command === "help" || command === "--help" || command === "-h") {
  console.log(renderHelp());
} else if (command === "doctor") {
  console.log(renderDoctor());
} else {
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
