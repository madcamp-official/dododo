import { readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

import type { SourceInputConfig } from "../../../../packages/collectors/src/index.ts";

const DEFAULT_RELATIVE_PATH = "./dododo.sources.json";

export interface ResolvedSourceInputConfigPath {
  path: string;
  // false면 DODODO_SOURCE_CONFIG 미설정 상태의 기본 경로(cwd 기준 ./dododo.sources.json)라는
  // 뜻이다 — doctor가 "환경변수로 지정함"과 "그 이름 파일이 cwd에 우연히 있어서 주움"을 구분해
  // 보여줄 수 있게 한다(PR #40 리뷰, 김도현 nit).
  isExplicit: boolean;
}

// 실제 학교 사이트 URL, 이메일 EML 디렉터리, LMS HTML 경로는 사람마다/환경마다 다르고
// 셀렉터 배열·중첩 객체가 있어 .env 한 줄로 표현하기 어렵다 — JSON 설정 파일로 분리한다.
// 파일이 없으면 undefined를 반환해 호출부가 기존 Fixture Collector로 폴백하게 한다
// (DODODO_DB_PATH/DODODO_LLM_BASE_URL과 같은 "설정 없으면 데모 모드" 패턴).
export function resolveSourceInputConfigPath(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): ResolvedSourceInputConfigPath {
  const raw = env.DODODO_SOURCE_CONFIG?.trim();
  const isExplicit = raw !== undefined && raw !== "";
  const path = isExplicit ? raw : DEFAULT_RELATIVE_PATH;
  return { path: isAbsolute(path) ? path : resolve(cwd, path), isExplicit };
}

export interface LoadedSourceInputConfig {
  config: SourceInputConfig;
  path: string;
}

// 파일이 없으면(가장 흔한 경우, 데모/테스트 환경) 조용히 undefined를 반환한다 — 단, 이건
// 기본 경로(DODODO_SOURCE_CONFIG 미설정)에서 못 찾았을 때만이다. 사용자가 환경변수로
// 경로를 명시했는데 그 파일이 없으면(오타·이동·삭제) 절대 조용히 Fixture로 넘기지 않고
// Error를 던진다 — 안 그러면 "실제 학교 데이터를 수집 중"이라 믿는 상태에서 실제로는
// Fixture 데모 데이터가 저장된다(doyeonid, PR #40 리뷰 P1).
// 파일은 있는데 JSON 파싱이나 내용이 잘못됐으면 마찬가지로 Error를 던진다 — 사용자가 직접
// 만든 설정 파일의 오타를 "그냥 Fixture로 폴백"해 조용히 숨기면 디버깅이 더 어려워진다
// (AGENTS.md: 오류를 숨기지 말고 원인과 다음 행동을 구분해 표현한다).
export function loadSourceInputConfig(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): LoadedSourceInputConfig | undefined {
  const { path, isExplicit } = resolveSourceInputConfigPath(env, cwd);

  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if (isFileNotFoundError(error)) {
      if (!isExplicit) return undefined;
      throw new Error(`DODODO_SOURCE_CONFIG로 지정한 설정 파일을 찾을 수 없습니다(${path})`);
    }
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

  return { config: resolveRelativeInputPaths(config as SourceInputConfig, dirname(path)), path };
}

// schoolEmail.inputDirectory/lms.inputPaths는 설정 파일 안의 상대 경로다. cwd 기준으로
// 풀면 설정 파일을 실행 위치와 다른 디렉터리(예: ~/dododo.sources.json)에 둔 순간
// 가리키는 대상이 달라진다 — 설정 파일이 있는 디렉터리 기준으로 고정한다
// (PR #40 리뷰, 김도현 — #45의 resolveInputPaths와 같은 정책).
function resolveRelativeInputPaths(config: SourceInputConfig, configDir: string): SourceInputConfig {
  const resolved: SourceInputConfig = { ...config };
  if (resolved.schoolEmail !== undefined) {
    resolved.schoolEmail = {
      ...resolved.schoolEmail,
      inputDirectory: resolveAgainst(resolved.schoolEmail.inputDirectory, configDir),
    };
  }
  if (resolved.lms !== undefined) {
    resolved.lms = {
      ...resolved.lms,
      inputPaths: resolved.lms.inputPaths.map((path) => resolveAgainst(path, configDir)),
    };
  }
  return resolved;
}

function resolveAgainst(path: string, baseDir: string): string {
  return isAbsolute(path) ? path : resolve(baseDir, path);
}

function isFileNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "ENOENT";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
