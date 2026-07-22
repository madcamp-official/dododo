import { load } from "cheerio";

import {
  DEFAULT_SCHOOL_SITE_SELECTORS,
  type ParsedSchoolNotice,
  type SchoolSiteFieldRecipe,
  type SchoolSiteRecipe,
  type SchoolSiteSelectors,
} from "./types.ts";

export interface ParseSchoolNoticeOptions {
  baseUrl: string;
  selectors?: Partial<SchoolSiteSelectors>;
  recipe?: SchoolSiteRecipe;
}

export function parseSchoolNoticeHtml(
  html: string,
  options: ParseSchoolNoticeOptions,
): ParsedSchoolNotice[] {
  if (options.recipe !== undefined) return parseWithRecipe(html, options.baseUrl, options.recipe);
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

export function parseSchoolNoticeDetailHtml(
  html: string,
  baseUrl: string,
  recipe: NonNullable<SchoolSiteRecipe["detail"]>,
): Pick<ParsedSchoolNotice, "content" | "attachmentUrls"> {
  const $ = load(html);
  return {
    content: recipe.content === undefined ? "" : readField($, $.root(), recipe.content),
    attachmentUrls: recipe.attachments === undefined
      ? []
      : readFields($, $.root(), recipe.attachments)
        .map((value) => resolveUrl(value, baseUrl))
        .filter((value): value is string => value !== undefined),
  };
}

function parseWithRecipe(
  html: string,
  baseUrl: string,
  recipe: SchoolSiteRecipe,
): ParsedSchoolNotice[] {
  const $ = load(html);
  const notices: ParsedSchoolNotice[] = [];
  $(recipe.list.item).each((_index, element) => {
    const item = $(element);
    const title = readField($, item, recipe.list.title);
    const href = readField($, item, recipe.list.link);
    const uri = resolveUrl(href, baseUrl);
    if (!title || uri === undefined) return;
    const externalId = extractExternalId($, item, uri, recipe.list.externalId);
    if (!externalId) return;
    const content = recipe.list.content === undefined ? "" : readField($, item, recipe.list.content);
    const publishedAt = recipe.list.publishedAt === undefined
      ? ""
      : readField($, item, recipe.list.publishedAt);
    const category = recipe.list.category === undefined
      ? ""
      : readField($, item, recipe.list.category);
    const attachmentUrls = recipe.list.attachments === undefined
      ? []
      : readFields($, item, recipe.list.attachments)
        .map((value) => resolveUrl(value, baseUrl))
        .filter((value): value is string => value !== undefined);
    notices.push({
      externalId,
      title,
      uri,
      content,
      attachmentUrls,
      publishedAt: publishedAt || undefined,
      category: category || undefined,
    });
  });
  return notices;
}

function readField(
  $: ReturnType<typeof load>,
  scope: ReturnType<ReturnType<typeof load>>,
  recipe: SchoolSiteFieldRecipe,
): string {
  const target = recipe.selector.trim() === "" ? scope.first() : scope.find(recipe.selector).first();
  return normalizeText(recipe.attribute === undefined ? target.text() : target.attr(recipe.attribute) ?? "");
}

function readFields(
  $: ReturnType<typeof load>,
  scope: ReturnType<ReturnType<typeof load>>,
  recipe: SchoolSiteFieldRecipe,
): string[] {
  const targets = recipe.selector.trim() === "" ? scope : scope.find(recipe.selector);
  return targets.toArray().map((element) => {
    const target = $(element);
    return normalizeText(recipe.attribute === undefined ? target.text() : target.attr(recipe.attribute) ?? "");
  }).filter(Boolean);
}

function extractExternalId(
  $: ReturnType<typeof load>,
  item: ReturnType<ReturnType<typeof load>>,
  uri: string,
  recipe: SchoolSiteRecipe["list"]["externalId"],
): string {
  if (recipe === undefined || recipe.strategy === "url-hash") {
    return new URL(uri).hash.slice(1) || uri;
  }
  if (recipe.strategy === "field") return readField($, item, recipe);
  if (recipe.strategy === "url-query") return new URL(uri).searchParams.get(recipe.parameter)?.trim() ?? "";
  const match = new RegExp(recipe.pattern).exec(new URL(uri).pathname);
  return (match?.[1] ?? match?.[0] ?? "").trim();
}

export function normalizeText(value: string): string {
  return value.replaceAll(/\s+/g, " ").trim();
}

function resolveUrl(value: string, baseUrl: string): string | undefined {
  try {
    const url = new URL(value, baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;

    return url.toString();
  } catch {
    return undefined;
  }
}
