export interface SchoolSiteSelectors {
  item: string;
  link: string;
  content: string;
  publishedAt: string;
  attachment: string;
  externalIdAttribute: string;
  categoryAttribute: string;
}

export interface ParsedSchoolNotice {
  externalId: string;
  title: string;
  uri: string;
  content: string;
  publishedAt?: string;
  attachmentUrls: string[];
  category?: string;
}

export interface SchoolSiteFieldRecipe {
  selector: string;
  attribute?: string;
}

export type SchoolSiteExternalIdRecipe =
  | ({ strategy: "field" } & SchoolSiteFieldRecipe)
  | { strategy: "url-query"; parameter: string }
  | { strategy: "url-path"; pattern: string }
  | { strategy: "url-hash" };

export interface SchoolSitePageRecipe {
  item: string;
  title: SchoolSiteFieldRecipe;
  link: SchoolSiteFieldRecipe;
  externalId?: SchoolSiteExternalIdRecipe;
  content?: SchoolSiteFieldRecipe;
  publishedAt?: SchoolSiteFieldRecipe;
  category?: SchoolSiteFieldRecipe;
  attachments?: SchoolSiteFieldRecipe;
}

/** Source별 DOM 차이는 코드가 아니라 이 JSON 직렬화 가능한 계약으로 표현한다. */
export interface SchoolSiteRecipe {
  encoding?: string;
  list: SchoolSitePageRecipe;
  detail?: Pick<SchoolSitePageRecipe, "content" | "attachments">;
  errorOnEmpty?: boolean;
}

export const DEFAULT_SCHOOL_SITE_SELECTORS: SchoolSiteSelectors = {
  item: ".notice-item",
  link: ".notice-link",
  content: ".notice-content",
  publishedAt: "time[datetime]",
  attachment: ".notice-attachment",
  externalIdAttribute: "data-notice-id",
  categoryAttribute: "data-category",
};
