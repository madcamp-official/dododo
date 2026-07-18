import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

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

    const profile: UserProfile = {
      school,
      major,
      year,
      interests,
      activityTypes,
      preferredLocations,
      explicitConstraints: [],
    };

    await container.profileRepository.save(profile);

    return ["프로필이 저장되었습니다.", "", renderSourceStatus(container)].join("\n");
  } finally {
    rl.close();
  }
}

async function askList(
  rl: ReturnType<typeof createInterface>,
  prompt: string,
): Promise<string[]> {
  const answer = await rl.question(prompt);
  return answer.split(",").map((value) => value.trim()).filter((value) => value.length > 0);
}
