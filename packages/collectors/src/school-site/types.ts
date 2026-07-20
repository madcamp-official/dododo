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

export const DEFAULT_SCHOOL_SITE_SELECTORS: SchoolSiteSelectors = {
  item: ".notice-item",
  link: ".notice-link",
  content: ".notice-content",
  publishedAt: "time[datetime]",
  attachment: ".notice-attachment",
  externalIdAttribute: "data-notice-id",
  categoryAttribute: "data-category",
};
