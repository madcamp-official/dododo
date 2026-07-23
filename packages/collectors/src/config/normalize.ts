import type { SchoolSiteSourceConfig, SourceInputConfig } from "./types.ts";

// v0.1.2 이전에는 schoolSite가 배열이 아니라 단일 객체였다. 그 시절 만들어진
// dododo.sources.json을 그대로 쓰는 사용자가 업그레이드 후 "schoolSite는 배열이어야
// 합니다" 에러로 막히지 않도록, 파싱 직후 항목 하나짜리 배열로 감싸 그대로 동작하게
// 한다. 이미 배열이거나 schoolSite가 없으면 손대지 않는다.
export function normalizeSourceInputConfig(config: SourceInputConfig): SourceInputConfig {
  const schoolSite = (config as { schoolSite?: unknown }).schoolSite;
  if (schoolSite === undefined || Array.isArray(schoolSite) || typeof schoolSite !== "object" || schoolSite === null) {
    return config;
  }
  return { ...config, schoolSite: [schoolSite as SchoolSiteSourceConfig] };
}
