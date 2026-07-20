import type { SchoolSiteFetch } from "../school-site/http-loader.ts";
import type { LmsHtmlSelectors } from "../lms/types.ts";
import type { SchoolSiteSelectors } from "../school-site/types.ts";

export interface SchoolSiteSourceConfig {
  enabled?: boolean;
  sourceId?: string;
  url: string;
  selectors?: Partial<SchoolSiteSelectors>;
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
  schoolSite?: SchoolSiteSourceConfig;
  schoolEmail?: SchoolEmailSourceConfig;
  lms?: LmsSourceConfig;
}

export interface SourceCollectorFactoryDependencies {
  fetchImplementation?: SchoolSiteFetch;
  now?: () => Date;
}
