import { createInterface } from "node:readline/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import { stdin, stdout } from "node:process";

import { isValidClockTime } from "../../../../packages/scheduler/src/index.ts";
import type { UserProfile } from "../../../../packages/shared/src/index.ts";
import type { CliContainer } from "../runtime/container.ts";
import {
  activateRemoteDevice,
  DEFAULT_REMOTE_GATEWAY_URL,
  DEFAULT_REMOTE_TIMEOUT_MS,
  saveRemoteLlmConfig,
} from "../runtime/remoteActivation.ts";
import { renderSourceStatus } from "../runtime/sourceStatus.ts";

export interface SetupIo {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
}

export interface SetupDependencies {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  deviceName?: string;
  fetchImplementation?: typeof fetch;
}

export async function runSetup(
  container: CliContainer,
  io: SetupIo = { input: stdin, output: stdout },
  dependencies: SetupDependencies = {},
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
    await configureRemoteLlm(rl, lines, dependencies);
    lines.push("", renderSourceStatus(container));
    return lines.join("\n");
  } finally {
    rl.close();
  }
}

async function configureRemoteLlm(
  rl: ReturnType<typeof createInterface>,
  lines: string[],
  dependencies: SetupDependencies,
): Promise<void> {
  const env = dependencies.env ?? process.env;
  const existingToken = env.DODODO_LLM_TOKEN?.trim();
  const existingProvider = env.DODODO_LLM_PROVIDER?.trim();
  if (existingProvider === "remote-job" && existingToken) {
    lines.push("원격 LLM: 기기 토큰이 이미 설정되어 있습니다.");
    lines.push("인증 추론 확인: npm start -- doctor --llm-test");
    return;
  }

  const activationCode = (await rl.question(
    "원격 LLM 설치 코드(선택한 Context가 팀 GPU 서버로 전송됨, 사용하지 않으면 Enter): ",
  )).trim();
  if (activationCode === "") {
    lines.push("원격 LLM 연결은 건너뛰었습니다.");
    return;
  }

  // README의 로컬 Ollama 예시를 복사한 .env가 있어도 설치 코드는 팀 Gateway로
  // 활성화해야 한다. 사용자가 remote-job을 명시한 경우에만 커스텀 원격 주소를 유지한다.
  const configuredRemoteUrl = existingProvider === "remote-job"
    ? env.DODODO_LLM_BASE_URL?.trim()
    : undefined;
  const baseUrl = configuredRemoteUrl || DEFAULT_REMOTE_GATEWAY_URL;
  try {
    const activation = await activateRemoteDevice({
      baseUrl,
      activationCode,
      deviceName: dependencies.deviceName ?? hostname(),
      ...(dependencies.fetchImplementation === undefined
        ? {}
        : { fetchImplementation: dependencies.fetchImplementation }),
    });
    await saveRemoteLlmConfig({
      envPath: join(dependencies.cwd ?? process.cwd(), ".env"),
      baseUrl,
      token: activation.token,
      timeoutMs: DEFAULT_REMOTE_TIMEOUT_MS,
    });
    lines.push("원격 LLM 기기 토큰을 .env에 안전하게 저장했습니다.");
    lines.push("인증 추론 확인: npm start -- doctor --llm-test");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    lines.push(`원격 LLM 설정 실패: ${reason}`);
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
