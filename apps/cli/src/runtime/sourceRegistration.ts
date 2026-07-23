import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import {
  normalizeSourceInputConfig,
  validateSourceInputConfig,
  type SchoolSiteSourceConfig,
  type SourceInputConfig,
} from "../../../../packages/collectors/src/index.ts";
import type { SourceType } from "../../../../packages/shared/src/index.ts";
import { resolveSourceInputConfigPath } from "./sourceInputConfig.ts";

export type RegisteredSourceType = Extract<SourceType, "school-site" | "school-email" | "lms">;

const REGISTERED_SOURCE_TYPES: ReadonlySet<string> = new Set(["school-site", "school-email", "lms"]);

export function isRegisteredSourceType(value: unknown): value is RegisteredSourceType {
  return typeof value === "string" && REGISTERED_SOURCE_TYPES.has(value);
}

export interface SourceListEntry {
  // school-email/lms는 type과 같은 고정 문자열이지만, school-site는 항목이 여럿일 수
  // 있어 개별 sourceId다(등록 순서와 무관하게 특정 URL 하나만 지울 수 있어야 한다).
  id: string;
  type: RegisteredSourceType;
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
  const config = normalizeSourceInputConfig(parsed as SourceInputConfig);
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
  for (const source of config.schoolSite ?? []) {
    if (source.enabled === false) continue;
    entries.push({ id: source.sourceId ?? "school-site", type: "school-site", value: source.url });
  }
  if (config.schoolEmail !== undefined && config.schoolEmail.enabled !== false) {
    entries.push({ id: "school-email", type: "school-email", value: config.schoolEmail.inputDirectory });
  }
  if (config.lms !== undefined && config.lms.enabled !== false) {
    entries.push({ id: "lms", type: "lms", value: config.lms.baseUrl });
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
//
// 같은 URL을 다시 등록하면 새 항목을 만들지 않고 조용히 무시한다(중복 방지) — 첫
// 등록은 기존처럼 sourceId를 생략해 "school-site" 기본값을 쓰고(하위 호환), 두 번째
// 항목부터는 URL에서 파생한 고유 sourceId를 자동으로 붙인다(validator.ts가 둘 이상일 때
// sourceId를 요구한다).
export function registerSchoolSiteSource(url: string, env: NodeJS.ProcessEnv = process.env): string {
  const current = readConfigFileOrEmpty(env);
  const existing = current.schoolSite ?? [];
  if (existing.some((entry) => entry.url === url)) {
    return writeConfigFile(current, env);
  }

  if (existing.length === 0) {
    const next: SourceInputConfig = { ...current, schoolSite: [{ url }] };
    validateSourceInputConfig(next);
    return writeConfigFile(next, env);
  }

  // 두 번째 항목부터는 validator가 모든 항목에 sourceId를 요구한다 — 첫 항목이 기존
  // 하위 호환 기본값(sourceId 생략 = "school-site")으로 저장돼 있었다면, 이제
  // 소급해서 명시적으로 채워 넣어야 새 항목과 함께 검증을 통과한다. listRegisteredSources가
  // 이미 같은 기본값을 "id"로 보여주고 있었으므로 사용자에게 보이는 값은 그대로다.
  const backfilled = existing.map((entry) => (entry.sourceId === undefined ? { ...entry, sourceId: "school-site" } : entry));
  const entry = { url, sourceId: generateSchoolSiteId(url, backfilled) };
  const next: SourceInputConfig = { ...current, schoolSite: [...backfilled, entry] };
  validateSourceInputConfig(next);
  return writeConfigFile(next, env);
}

export function removeRegisteredSource(id: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const current = readConfigFileOrEmpty(env);

  if (id === "school-email" || id === "lms") {
    const key = id === "school-email" ? "schoolEmail" : "lms";
    if (current[key] === undefined) return false;
    const next = { ...current };
    delete next[key];
    writeConfigFile(next, env);
    return true;
  }

  const existing = current.schoolSite ?? [];
  const remaining = existing.filter((entry) => (entry.sourceId ?? "school-site") !== id);
  if (remaining.length === existing.length) return false;

  const next = { ...current };
  if (remaining.length === 0) delete next.schoolSite;
  else next.schoolSite = remaining;
  writeConfigFile(next, env);
  return true;
}

const SCHOOL_SITE_ID_PREFIX = "school-site-";

// 호스트명을 사람이 알아볼 수 있는 접두어로 쓰고, 같은 호스트에 게시판이 여럿이거나
// 우연히 슬러그가 겹치면 URL 전체의 짧은 해시를 덧붙여 항상 고유하게 만든다.
function generateSchoolSiteId(url: string, existing: SchoolSiteSourceConfig[]): string {
  const existingIds = new Set(existing.map((entry) => entry.sourceId ?? "school-site"));
  const hostSlug = safeHostSlug(url);
  const candidate = `${SCHOOL_SITE_ID_PREFIX}${hostSlug}`;
  if (!existingIds.has(candidate)) return candidate;

  const hash = createHash("sha256").update(url).digest("hex").slice(0, 6);
  return `${candidate}-${hash}`;
}

function safeHostSlug(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/[^a-z0-9.-]/g, "-");
  } catch {
    return "site";
  }
}
