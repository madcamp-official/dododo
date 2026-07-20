import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

import type { SourceInputConfig } from "../../../../packages/collectors/src/index.ts";

const DEFAULT_RELATIVE_PATH = "./dododo.sources.json";

// 실제 학교 사이트 URL, 이메일 EML 디렉터리, LMS HTML 경로는 사람마다/환경마다 다르고
// 셀렉터 배열·중첩 객체가 있어 .env 한 줄로 표현하기 어렵다 — JSON 설정 파일로 분리한다.
// 파일이 없으면 undefined를 반환해 호출부가 기존 Fixture Collector로 폴백하게 한다
// (DODODO_DB_PATH/DODODO_LLM_BASE_URL과 같은 "설정 없으면 데모 모드" 패턴).
export function resolveSourceInputConfigPath(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): string {
  const raw = env.DODODO_SOURCES_CONFIG_PATH?.trim();
  const path = raw === undefined || raw === "" ? DEFAULT_RELATIVE_PATH : raw;
  return isAbsolute(path) ? path : resolve(cwd, path);
}

export interface LoadedSourceInputConfig {
  config: SourceInputConfig;
  path: string;
}

// 파일이 없으면(가장 흔한 경우, 데모/테스트 환경) 조용히 undefined를 반환한다.
// 파일은 있는데 JSON 파싱이나 내용이 잘못됐으면 Error를 던진다 — 사용자가 직접
// 만든 설정 파일의 오타를 "그냥 Fixture로 폴백"해 조용히 숨기면 디버깅이 더 어려워진다
// (AGENTS.md: 오류를 숨기지 말고 원인과 다음 행동을 구분해 표현한다).
export function loadSourceInputConfig(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): LoadedSourceInputConfig | undefined {
  const path = resolveSourceInputConfigPath(env, cwd);

  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if (isFileNotFoundError(error)) return undefined;
    throw new Error(`Source 설정 파일을 읽을 수 없습니다(${path}): ${errorMessage(error)}`);
  }

  let config: unknown;
  try {
    config = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Source 설정 파일이 올바른 JSON이 아닙니다(${path}): ${errorMessage(error)}`);
  }

  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    throw new Error(`Source 설정 파일의 최상위 값은 객체여야 합니다(${path})`);
  }

  return { config: config as SourceInputConfig, path };
}

function isFileNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "ENOENT";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
