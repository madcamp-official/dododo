import { load } from "cheerio";

import {
  DEFAULT_SCHOOL_SITE_SELECTORS,
  type ParsedSchoolNotice,
  type SchoolSiteSelectors,
} from "./types.ts";

export interface ParseSchoolNoticeOptions {
  baseUrl: string;
  selectors?: Partial<SchoolSiteSelectors>;
}

export function parseSchoolNoticeHtml(
  html: string,
  options: ParseSchoolNoticeOptions,
): ParsedSchoolNotice[] {
  const selectors: SchoolSiteSelectors = {
    ...DEFAULT_SCHOOL_SITE_SELECTORS,
    ...options.selectors,
  };
  const $ = load(html);
  const notices: ParsedSchoolNotice[] = [];

  $(selectors.item).each((_index, element) => {
    const item = $(element);
    const externalId = item.attr(selectors.externalIdAttribute)?.trim();
    const link = item.find(selectors.link).first();
    const href = link.attr("href")?.trim();
    const title = normalizeText(link.text());
    const content = normalizeText(item.find(selectors.content).first().text());

    if (!externalId || !href || !title || !content) return;
    const uri = resolveUrl(href, options.baseUrl);
    if (uri === undefined) return;

    const publishedAt = item.find(selectors.publishedAt).first().attr("datetime")?.trim();
    const category = item.attr(selectors.categoryAttribute)?.trim();
    const attachmentUrls = item
      .find(selectors.attachment)
      .toArray()
      .map((attachment) => $(attachment).attr("href")?.trim())
      .filter((attachmentHref): attachmentHref is string => Boolean(attachmentHref))
      .map((attachmentHref) => resolveUrl(attachmentHref, options.baseUrl))
      .filter((attachmentUrl): attachmentUrl is string => attachmentUrl !== undefined);

    notices.push({
      externalId,
      title,
      uri,
      content,
      publishedAt: publishedAt || undefined,
      attachmentUrls,
      category: category || undefined,
    });
  });

  return notices;
}

export function normalizeText(value: string): string {
  return value.replaceAll(/\s+/g, " ").trim();
}

function resolveUrl(value: string, baseUrl: string): string | undefined {
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return undefined;
  }
}
