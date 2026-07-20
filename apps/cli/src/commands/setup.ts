import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import { isValidClockTime } from "../../../../packages/scheduler/src/index.ts";
import type { UserProfile } from "../../../../packages/shared/src/index.ts";
import type { CliContainer } from "../runtime/container.ts";
import { renderSourceStatus } from "../runtime/sourceStatus.ts";

export interface SetupIo {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
}

export async function runSetup(
  container: CliContainer,
  io: SetupIo = { input: stdin, output: stdout },
): Promise<string> {
  const rl = createInterface({ input: io.input, output: io.output });

  try {
    const school = await rl.question("학교: ");
    const major = await rl.question("전공: ");
    const year = await rl.question("학년: ");
    const interests = await askList(rl, "관심 분야(쉼표로 구분): ");
    const activityTypes = await askList(rl, "선호 활동 종류(쉼표로 구분): ");
    const preferredLocations = await askList(rl, "선호 지역·온라인 여부(쉼표로 구분, 없으면 Enter): ");
    const quietHours = await askQuietHours(rl);

    const profile: UserProfile = {
      school,
      major,
      year,
      interests,
      activityTypes,
      preferredLocations,
      explicitConstraints: [],
      ...(quietHours.value === undefined ? {} : { quietHours: quietHours.value }),
    };

    await container.profileRepository.save(profile);

    const lines = ["프로필이 저장되었습니다."];
    if (quietHours.warning !== undefined) lines.push(quietHours.warning);
    lines.push("", renderSourceStatus(container));
    return lines.join("\n");
  } finally {
    rl.close();
  }
}

// 시작 시각을 비워두면 Quiet Hours를 아예 설정하지 않는다. 형식이 잘못되면
// (quietHours.ts의 fail-open 정책과 일관되게) setup을 막지 않고 그냥 건너뛴다 —
// 대신 왜 건너뛰었는지 경고 메시지를 요약에 남긴다.
async function askQuietHours(
  rl: ReturnType<typeof createInterface>,
): Promise<{ value?: { start: string; end: string }; warning?: string }> {
  const start = (await rl.question("방해 금지 시작 시각(HH:mm, 없으면 Enter): ")).trim();
  if (start === "") return {};
  if (!isValidClockTime(start)) {
    return { warning: `시작 시각 '${start}'이(가) HH:mm 형식이 아니라 Quiet Hours를 설정하지 않았습니다.` };
  }

  const end = (await rl.question("방해 금지 종료 시각(HH:mm): ")).trim();
  if (!isValidClockTime(end)) {
    return { warning: `종료 시각 '${end}'이(가) HH:mm 형식이 아니라 Quiet Hours를 설정하지 않았습니다.` };
  }

  return { value: { start, end } };
}

async function askList(
  rl: ReturnType<typeof createInterface>,
  prompt: string,
): Promise<string[]> {
  const answer = await rl.question(prompt);
  return answer.split(",").map((value) => value.trim()).filter((value) => value.length > 0);
}
