import type { SchoolSiteFetch } from "../school-site/http-loader.ts";
import type { LmsHtmlSelectors } from "../lms/types.ts";
import type { SchoolSiteRecipe, SchoolSiteSelectors } from "../school-site/types.ts";

export interface SchoolSiteSourceConfig {
  enabled?: boolean;
  sourceId?: string;
  url: string;
  selectors?: Partial<SchoolSiteSelectors>;
  recipe?: SchoolSiteRecipe;
  timeoutMs?: number;
  maxResponseBytes?: number;
}

export interface SchoolEmailSourceConfig {
  enabled?: boolean;
  sourceId?: string;
  inputDirectory: string;
  allowedSenderDomains: string[];
  maxMessageBytes?: number;
}

export interface LmsSourceConfig {
  enabled?: boolean;
  sourceId?: string;
  baseUrl: string;
  inputPaths: string[];
  selectors: LmsHtmlSelectors;
  maxDocumentBytes?: number;
}

export interface SourceInputConfig {
  // 여러 학교 공지 사이트를 동시에 등록할 수 있게 배열이다. sourceId는 항목이
  // 하나뿐일 때는 생략 가능(기존처럼 "school-site" 기본값)하지만, 둘 이상이면
  // RawItem.sourceId 충돌을 막기 위해 각 항목마다 고유해야 한다(validator.ts).
  schoolSite?: SchoolSiteSourceConfig[];
  schoolEmail?: SchoolEmailSourceConfig;
  lms?: LmsSourceConfig;
}

export interface SourceCollectorFactoryDependencies {
  fetchImplementation?: SchoolSiteFetch;
  now?: () => Date;
}
