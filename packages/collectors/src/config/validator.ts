import type {
  LmsSourceConfig,
  SchoolEmailSourceConfig,
  SchoolSiteSourceConfig,
  SourceInputConfig,
} from "./types.ts";

export function validateSourceInputConfig(config: SourceInputConfig): SourceInputConfig {
  if (config.schoolSite?.enabled !== false) validateSchoolSite(config.schoolSite);
  if (config.schoolEmail?.enabled !== false) validateSchoolEmail(config.schoolEmail);
  if (config.lms?.enabled !== false) validateLms(config.lms);
  return config;
}

function validateSchoolSite(config: SchoolSiteSourceConfig | undefined): void {
  if (config === undefined) return;
  let url: URL;
  try {
    url = new URL(config.url);
  } catch {
    throw new Error(`schoolSite.url이 유효한 URL이 아닙니다: ${config.url}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("schoolSite.url은 HTTP 또는 HTTPS여야 합니다");
  }
  validateSourceId(config.sourceId, "schoolSite.sourceId");
  validatePositiveInteger(config.timeoutMs, "schoolSite.timeoutMs");
  validatePositiveInteger(config.maxResponseBytes, "schoolSite.maxResponseBytes");
  if (config.recipe !== undefined) {
    validateNonEmpty(config.recipe.list.item, "schoolSite.recipe.list.item");
    validateField(config.recipe.list.title, "schoolSite.recipe.list.title");
    validateField(config.recipe.list.link, "schoolSite.recipe.list.link");
    if (config.recipe.list.externalId?.strategy === "url-query") {
      validateNonEmpty(config.recipe.list.externalId.parameter, "schoolSite.recipe.list.externalId.parameter");
    }
    if (config.recipe.list.externalId?.strategy === "url-path") {
      validateNonEmpty(config.recipe.list.externalId.pattern, "schoolSite.recipe.list.externalId.pattern");
      try { new RegExp(config.recipe.list.externalId.pattern); } catch {
        throw new Error("schoolSite.recipe.list.externalId.pattern이 유효한 정규식이 아닙니다");
      }
    }
    if (config.recipe.encoding !== undefined) {
      try { new TextDecoder(config.recipe.encoding); } catch {
        throw new Error(`지원하지 않는 schoolSite.recipe.encoding입니다: ${config.recipe.encoding}`);
      }
    }
  }
}

function validateField(value: { selector: string; attribute?: string }, field: string): void {
  if (value.selector.trim() === "" && value.attribute === undefined) {
    throw new Error(`${field}는 selector 또는 attribute 추출을 지정해야 합니다`);
  }
  if (value.attribute !== undefined) validateNonEmpty(value.attribute, `${field}.attribute`);
}

function validateNonEmpty(value: string, field: string): void {
  if (value.trim() === "") throw new Error(`${field}는 비어 있을 수 없습니다`);
}

function validateSchoolEmail(config: SchoolEmailSourceConfig | undefined): void {
  if (config === undefined) return;
  validateSourceId(config.sourceId, "schoolEmail.sourceId");
  validatePath(config.inputDirectory, "schoolEmail.inputDirectory");
  if (config.allowedSenderDomains.length === 0) {
    throw new Error("schoolEmail.allowedSenderDomains는 하나 이상이어야 합니다");
  }
  for (const domain of config.allowedSenderDomains) {
    if (!isDomain(domain)) {
      throw new Error(`허용 이메일 도메인이 유효하지 않습니다: ${domain}`);
    }
  }
  validatePositiveInteger(config.maxMessageBytes, "schoolEmail.maxMessageBytes");
}

function validateLms(config: LmsSourceConfig | undefined): void {
  if (config === undefined) return;
  validateSourceId(config.sourceId, "lms.sourceId");
  validateHttpUrl(config.baseUrl, "lms.baseUrl");
  if (config.inputPaths.length === 0) {
    throw new Error("lms.inputPaths는 하나 이상이어야 합니다");
  }
  for (const path of config.inputPaths) {
    validatePath(path, "lms.inputPaths");
    if (!path.toLowerCase().endsWith(".html") && !path.toLowerCase().endsWith(".htm")) {
      throw new Error(`LMS 입력 파일은 .html 또는 .htm이어야 합니다: ${path}`);
    }
  }
  if (config.selectors.item.trim() === "" || config.selectors.title.trim() === "") {
    throw new Error("lms.selectors.item과 lms.selectors.title은 필수입니다");
  }
  validatePositiveInteger(config.maxDocumentBytes, "lms.maxDocumentBytes");
}

function validateHttpUrl(value: string, field: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${field}이 유효한 URL이 아닙니다: ${value}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${field}은 HTTP 또는 HTTPS여야 합니다`);
  }
}

function validateSourceId(value: string | undefined, field: string): void {
  if (value !== undefined && value.trim() === "") throw new Error(`${field}는 비어 있을 수 없습니다`);
}

function validatePath(value: string, field: string): void {
  if (value.trim() === "") throw new Error(`${field}는 비어 있을 수 없습니다`);
}

function validatePositiveInteger(value: number | undefined, field: string): void {
  if (value !== undefined && (!Number.isInteger(value) || value <= 0)) {
    throw new Error(`${field}는 0보다 큰 정수여야 합니다`);
  }
}

function isDomain(value: string): boolean {
  return value === value.trim()
    && value.length > 0
    && !value.includes("@")
    && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(value);
}
