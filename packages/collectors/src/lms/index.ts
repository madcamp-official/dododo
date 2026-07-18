import { createHash } from "node:crypto";
import type { RawItem } from "../../../shared/src/index.ts";
import { BaseCollector } from "../base.ts";
import { parseLmsHtml } from "./parser.ts";
import type {
  LmsCollectionError,
  LmsHtmlInput,
  LmsHtmlSelectors,
  ParsedLmsItem,
} from "./types.ts";

export type { LmsCollectionError, LmsHtmlInput, LmsHtmlSelectors } from "./types.ts";

const DEFAULT_MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;

export interface LmsCollectorOptions {
  sourceId?: string;
  selectors: LmsHtmlSelectors;
  loadDocuments: () => Promise<LmsHtmlInput[]>;
  maxDocumentBytes?: number;
  now?: () => Date;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function toRawItem(
  sourceId: string,
  item: ParsedLmsItem,
  observedAt: string,
): RawItem {
  const identity = `${sourceId}\0${item.externalId}`;
  const hashInput = JSON.stringify({
    title: item.title,
    content: item.content,
    course: item.course,
    category: item.category,
    publishedAt: item.publishedAt,
    dueAt: item.dueAt,
  });

  return {
    id: `lms-${hash(identity).slice(0, 16)}`,
    sourceId,
    sourceType: "lms",
    externalId: item.externalId,
    uri: item.uri,
    title: item.title,
    content: item.content,
    contentHash: hash(hashInput),
    observedAt,
    metadata: {
      official: true,
      ...(item.course ? { course: item.course } : {}),
      ...(item.category ? { category: item.category } : {}),
      ...(item.publishedAt ? { publishedAt: item.publishedAt } : {}),
      ...(item.dueAt ? { dueAt: item.dueAt } : {}),
    },
  };
}

export class LmsCollector extends BaseCollector {
  private readonly options: LmsCollectorOptions;
  private errors: LmsCollectionError[] = [];

  constructor(options: LmsCollectorOptions) {
    super(options.sourceId ?? "lms", "lms");
    this.options = options;
  }

  listErrors(): LmsCollectionError[] {
    return structuredClone(this.errors);
  }

  async sync(): Promise<RawItem[]> {
    this.errors = [];
    const documents = await this.options.loadDocuments();
    const observedAt = (this.options.now ?? (() => new Date()))().toISOString();
    const maxBytes = this.options.maxDocumentBytes ?? DEFAULT_MAX_DOCUMENT_BYTES;
    const rawItems: RawItem[] = [];

    for (const document of documents) {
      const size = Buffer.byteLength(document.html, "utf8");
      if (size > maxBytes) {
        this.errors.push({
          sourceUri: document.sourceUri,
          message: `LMS HTML 크기 ${size} bytes가 제한 ${maxBytes} bytes를 초과했습니다`,
        });
        continue;
      }

      try {
        const parsed = parseLmsHtml(document, this.options.selectors);
        this.errors.push(...parsed.errors);
        rawItems.push(
          ...parsed.items.map((item) => toRawItem(this.sourceId, item, observedAt)),
        );
      } catch (error) {
        this.errors.push({
          sourceUri: document.sourceUri,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return rawItems;
  }
}
