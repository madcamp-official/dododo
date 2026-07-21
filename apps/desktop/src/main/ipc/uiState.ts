import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fail, ok, type Result } from "./result.ts";

// docs/frontend-plan.md 6.4: 로컬 UI 상태(예: "마지막 인사 날짜")는 Renderer의
// localStorage가 아니라 Main이 app.getPath("userData") 아래 작은 JSON 파일 하나로
// 관리한다. 실제 userData 경로는 ipc/index.ts가 등록 시점에 app.getPath로 주입하고,
// 이 파일은 경로를 매개변수로 받아 electron 없이도 테스트할 수 있게 한다(다른
// ipc/*.ts와 같은 순수 로직 분리 패턴).
async function readState(filePath: string): Promise<Record<string, unknown>> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }

  const parsed: unknown = JSON.parse(raw);
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

async function writeState(filePath: string, state: Record<string, unknown>): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(state, null, 2), "utf8");
}

export async function getUiState(filePath: string, key: string): Promise<Result<unknown>> {
  try {
    const state = await readState(filePath);
    return ok(state[key]);
  } catch (error) {
    return fail("unknown", error instanceof Error ? error.message : String(error));
  }
}

export async function setUiState(filePath: string, key: string, value: unknown): Promise<Result<void>> {
  try {
    const state = await readState(filePath);
    state[key] = value;
    await writeState(filePath, state);
    return ok(undefined);
  } catch (error) {
    return fail("unknown", error instanceof Error ? error.message : String(error));
  }
}
