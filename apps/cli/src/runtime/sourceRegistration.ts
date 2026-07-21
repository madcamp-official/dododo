import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { validateSourceInputConfig, type SourceInputConfig } from "../../../../packages/collectors/src/index.ts";
import type { SourceType } from "../../../../packages/shared/src/index.ts";
import { resolveSourceInputConfigPath } from "./sourceInputConfig.ts";

export type RegisteredSourceType = Extract<SourceType, "school-site" | "school-email" | "lms">;

const REGISTERED_SOURCE_TYPES: ReadonlySet<string> = new Set(["school-site", "school-email", "lms"]);

export function isRegisteredSourceType(value: unknown): value is RegisteredSourceType {
  return typeof value === "string" && REGISTERED_SOURCE_TYPES.has(value);
}

export interface SourceListEntry {
  id: RegisteredSourceType;
  value: string;
}

// doyeonid 리뷰(PR #67) 1번: sourceInputConfig.ts(loadSourceInputConfig)와 같은 정책을
// 따른다 — DODODO_SOURCE_CONFIG로 명시한 경로가 없으면 오타를 조용히 빈 설정으로
// 넘기지 않고 에러로 알린다. 기본 경로(cwd의 dododo.sources.json)가 없는 건 "아직
// 아무것도 등록 안 함"이라는 정상 상태라 빈 설정으로 취급한다.
function readConfigFileOrEmpty(env: NodeJS.ProcessEnv): SourceInputConfig {
  const { path, isExplicit } = resolveSourceInputConfigPath(env);
  if (!existsSync(path)) {
    if (isExplicit) {
      throw new Error(`DODODO_SOURCE_CONFIG로 지정한 설정 파일을 찾을 수 없습니다(${path})`);
    }
    return {};
  }

  const raw = readFileSync(path, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Source 설정 파일이 올바른 JSON이 아닙니다(${path}): ${error instanceof Error ? error.message : String(error)}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Source 설정 파일의 최상위 값은 객체여야 합니다(${path})`);
  }

  // doyeonid 리뷰(PR #67) 2번: 최상위가 객체인지만 확인하면 { schoolSite: {} }처럼
  // url이 없는 항목도 그대로 통과해 source:list에서 value: undefined인 줄이 생겼다 —
  // createSourceCollectors()가 실제로 쓰는 것과 같은 validateSourceInputConfig로
  // 구조를 검증한다(중복 구현하지 않음). enabled:false인 항목은 검증에서 빠지는데,
  // listRegisteredSources도 enabled:false는 목록에서 제외해 짝을 맞춘다.
  const config = parsed as SourceInputConfig;
  validateSourceInputConfig(config);
  return config;
}

function writeConfigFile(config: SourceInputConfig, env: NodeJS.ProcessEnv): string {
  const { path } = resolveSourceInputConfigPath(env);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return path;
}

// 3개 타입 다 목록/제거는 가능하다(사람이 JSON을 직접 만들어 school-email/lms를
// 이미 설정해 둔 경우도 있을 수 있다) — register만 school-site로 제한한다.
//
// doyeonid 리뷰(PR #67) 2번: enabled:false Source는 목록에서 제외한다 —
// createSourceCollectors()가 enabled:false를 실제 Collector로 만들지 않는 것과
// 같은 기준이다(factory.ts). enabled:false는 validateSourceInputConfig도 검증을
// 건너뛰므로(위 readConfigFileOrEmpty) url 등 필수 필드가 없을 수 있다 — 이 필터가
// 없으면 그 값이 목록에 value: undefined로 새어 나간다.
export function listRegisteredSources(env: NodeJS.ProcessEnv = process.env): SourceListEntry[] {
  const config = readConfigFileOrEmpty(env);
  const entries: SourceListEntry[] = [];
  if (config.schoolSite !== undefined && config.schoolSite.enabled !== false) {
    entries.push({ id: "school-site", value: config.schoolSite.url });
  }
  if (config.schoolEmail !== undefined && config.schoolEmail.enabled !== false) {
    entries.push({ id: "school-email", value: config.schoolEmail.inputDirectory });
  }
  if (config.lms !== undefined && config.lms.enabled !== false) {
    entries.push({ id: "lms", value: config.lms.baseUrl });
  }
  return entries;
}

// docs/frontend-plan.md 2.3: school-site만 지원한다 — SchoolSiteSourceConfig.selectors가
// Partial이라 URL 하나만으로 기본값 동작이 실제로 성립하는 유일한 타입이다.
// school-email은 allowedSenderDomains(개인정보 범위, 안전한 기본값이 없음), lms는
// selectors 전체가 필수라 "URL/경로만" 입력으로는 유효한 설정을 만들 수 없다 —
// packages/collectors(공동 소유)를 건드리지 않고는 못 늘린다. Result의 validateSourceInputConfig가
// URL 형식·프로토콜 검증을 그대로 재사용해 이 파일에서 같은 검증을 중복하지 않는다.
//
// 등록은 파일만 쓴다 — 실행 중인 CliContainer의 collectors/privacyGateway는 시작 시
// 한 번만 구성되므로 재시작 후에야 반영된다(팀 논의로 확정, container 즉시 재구성은
// watch 루프·notifier 재배선까지 필요해 범위 밖으로 미룸).
export function registerSchoolSiteSource(url: string, env: NodeJS.ProcessEnv = process.env): string {
  const current = readConfigFileOrEmpty(env);
  const next: SourceInputConfig = { ...current, schoolSite: { url } };
  validateSourceInputConfig(next);
  return writeConfigFile(next, env);
}

export function removeRegisteredSource(id: RegisteredSourceType, env: NodeJS.ProcessEnv = process.env): boolean {
  const current = readConfigFileOrEmpty(env);
  const key = toConfigKey(id);
  if (current[key] === undefined) return false;

  const next = { ...current };
  delete next[key];
  writeConfigFile(next, env);
  return true;
}

function toConfigKey(id: RegisteredSourceType): keyof SourceInputConfig {
  if (id === "school-site") return "schoolSite";
  if (id === "school-email") return "schoolEmail";
  return "lms";
}
