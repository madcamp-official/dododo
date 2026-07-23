import { readFileSync } from "node:fs";
import { join } from "node:path";

// CLI는 npm start -- setup으로 설치 코드를 입력받아 .env에 원격 LLM Token을 저장하지만,
// 더블클릭으로 실행되는 패키징된 Desktop 앱은 어떤 .env도 로드하지 않는다 — 그 결과
// process.env에 DODODO_LLM_*이 전혀 없어 원격 LLM이 항상 꺼진 채로 배포됐다(로컬 규칙
// 기반 폴백만 동작). 폐쇄된 팀 커뮤니티에 배포하는 빌드는 설치 코드 입력 단계 없이
// 바로 팀 Gateway에 연결돼야 하므로, electron-builder가 패키징하는 리소스 안에
// 빌드 시점에만 채워 넣는 이 파일로 기본값을 제공한다. 실제 Token 값은 Git에 올리지
// 않는다(.gitignore) — apps/desktop/resources/bundled-llm-default.example.json이
// 형식 예시다.
const BUNDLED_LLM_DEFAULT_RELATIVE_PATH = "apps/desktop/resources/bundled-llm-default.json";

export interface BundledLlmDefaults {
  DODODO_LLM_PROVIDER?: string;
  DODODO_LLM_BASE_URL?: string;
  DODODO_LLM_TOKEN?: string;
  DODODO_LLM_TIMEOUT_MS?: string;
}

// appRoot: 패키징된 앱에서는 app.getAppPath()(asar 루트), 개발 중에는 저장소 루트 —
// 둘 다 apps/desktop/resources/... 상대 경로가 그대로 맞아떨어진다. 파일이 없거나
// 형식이 잘못돼도(빌드 스크립트 실수 등) 절대 throw하지 않는다 — 이 값은 순수
// 안전망이므로 실패하면 기존처럼 로컬 폴백으로 조용히 돌아가야 한다.
export function loadBundledLlmDefaults(appRoot: string): BundledLlmDefaults {
  let raw: string;
  try {
    raw = readFileSync(join(appRoot, BUNDLED_LLM_DEFAULT_RELATIVE_PATH), "utf8");
  } catch {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null) return {};
  const record = parsed as Record<string, unknown>;

  const defaults: BundledLlmDefaults = {};
  if (typeof record.provider === "string") defaults.DODODO_LLM_PROVIDER = record.provider;
  if (typeof record.baseUrl === "string") defaults.DODODO_LLM_BASE_URL = record.baseUrl;
  if (typeof record.token === "string") defaults.DODODO_LLM_TOKEN = record.token;
  if (typeof record.timeoutMs === "number") defaults.DODODO_LLM_TIMEOUT_MS = String(record.timeoutMs);
  return defaults;
}

// 개발자가 명시적으로 설정한 환경변수(.env, 셸 export)가 항상 우선한다 — 번들 기본값은
// 아무 값도 없을 때만 빈 자리를 채우는 폴백이다.
export function mergeLlmEnvDefaults(
  env: NodeJS.ProcessEnv,
  defaults: BundledLlmDefaults,
): NodeJS.ProcessEnv {
  const merged: NodeJS.ProcessEnv = { ...env };
  for (const [key, value] of Object.entries(defaults)) {
    if (!merged[key]) merged[key] = value;
  }
  return merged;
}
