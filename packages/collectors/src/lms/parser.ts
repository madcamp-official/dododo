import { load } from "cheerio";
import type { Cheerio } from "cheerio";
import type { AnyNode } from "domhandler";
import type {
  LmsCollectionError,
  LmsHtmlInput,
  LmsHtmlSelectors,
  ParsedLmsItem,
} from "./types.ts";

function normalizeText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function selectText(item: Cheerio<AnyNode>, selector?: string): string | undefined {
  if (!selector) return undefined;
  const value = normalizeText(item.find(selector).first().text());
  return value || undefined;
}

function selectValue(item: Cheerio<AnyNode>, selector?: string): string | undefined {
  if (!selector) return undefined;

  const attributeMatch = selector.match(/^(.*)::attr\(([^)]+)\)$/u);
  if (attributeMatch) {
    const [, elementSelector, attribute] = attributeMatch;
    const target = elementSelector ? item.find(elementSelector).first() : item;
    return target.attr(attribute)?.trim() || undefined;
  }

  return selectText(item, selector);
}

function resolveUri(sourceUri: string, link?: string): string {
  if (!link) return sourceUri;
  try {
    return new URL(link, sourceUri).toString();
  } catch {
    throw new Error(`유효하지 않은 LMS 링크입니다: ${link}`);
  }
}

export function parseLmsHtml(
  input: LmsHtmlInput,
  selectors: LmsHtmlSelectors,
): { items: ParsedLmsItem[]; errors: LmsCollectionError[] } {
  const $ = load(input.html);
  const elements = $(selectors.item).toArray();
  if (elements.length === 0) {
    throw new Error(`LMS 항목 선택자와 일치하는 요소가 없습니다: ${selectors.item}`);
  }

  const items: ParsedLmsItem[] = [];
  const errors: LmsCollectionError[] = [];

  elements.forEach((element, itemIndex) => {
    try {
      const item = $(element);
      const title = selectText(item, selectors.title);
      const link = selectValue(item, selectors.link);
      const externalId =
        selectValue(item, selectors.externalId) ??
        link;

      if (!title) throw new Error("LMS 항목 제목이 없습니다");
      if (!externalId) {
        throw new Error("LMS 항목 ID 또는 원본 링크가 없습니다");
      }

      items.push({
        externalId,
        course: selectText(item, selectors.course),
        category: selectText(item, selectors.category),
        title,
        content: selectText(item, selectors.content) ?? title,
        publishedAt: selectValue(item, selectors.publishedAt),
        dueAt: selectValue(item, selectors.dueAt),
        uri: resolveUri(input.sourceUri, link),
      });
    } catch (error) {
      errors.push({
        sourceUri: input.sourceUri,
        itemIndex,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return { items, errors };
}
