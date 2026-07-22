import { createHash } from "node:crypto";

import type { RawItem } from "../../../shared/src/index.ts";
import { BaseCollector } from "../base.ts";
import { parseSchoolNoticeDetailHtml, parseSchoolNoticeHtml } from "./parser.ts";
import type { ParsedSchoolNotice, SchoolSiteRecipe, SchoolSiteSelectors } from "./types.ts";

export interface SchoolSiteCollectorOptions {
  sourceId?: string;
  baseUrl: string;
  loadHtml: (url?: string) => Promise<string>;
  selectors?: Partial<SchoolSiteSelectors>;
  recipe?: SchoolSiteRecipe;
  now?: () => Date;
}

export class SchoolSiteCollector extends BaseCollector {
  private readonly options: SchoolSiteCollectorOptions;
  private errors: Array<{ sourceUri?: string; message: string }> = [];

  constructor(options: SchoolSiteCollectorOptions) {
    super(options.sourceId ?? "school-site", "school-site");
    this.options = options;
  }

  async sync(): Promise<RawItem[]> {
    this.errors = [];
    const html = await this.options.loadHtml();
    const observedAt = (this.options.now ?? (() => new Date()))().toISOString();
    let notices = parseSchoolNoticeHtml(html, {
      baseUrl: this.options.baseUrl,
      selectors: this.options.selectors,
      recipe: this.options.recipe,
    });
    if (this.options.recipe !== undefined
      && (this.options.recipe.errorOnEmpty ?? true)
      && notices.length === 0) {
      throw new Error(`학교 사이트 Recipe가 공지 항목을 찾지 못했습니다: ${this.options.baseUrl}`);
    }
    if (this.options.recipe?.detail !== undefined) {
      const detailed: ParsedSchoolNotice[] = [];
      for (const notice of notices) {
        try {
          detailed.push(await this.loadDetail(notice));
        } catch (error) {
          this.errors.push({
            sourceUri: notice.uri,
            message: `상세 공지를 읽지 못했습니다: ${error instanceof Error ? error.message : String(error)}`,
          });
          detailed.push(notice);
        }
      }
      notices = detailed;
    }
    notices = [...new Map(notices.map((notice) => [notice.externalId, notice])).values()];

    return notices.map((notice) => {
      const metadata: Record<string, unknown> = {
        official: true,
        attachmentUrls: notice.attachmentUrls,
      };
      if (notice.publishedAt !== undefined) metadata.publishedAt = notice.publishedAt;
      if (notice.category !== undefined) metadata.category = notice.category;

      return {
        id: stableRawItemId(this.sourceId, notice.externalId),
        sourceId: this.sourceId,
        sourceType: this.sourceType,
        externalId: notice.externalId,
        uri: notice.uri,
        title: notice.title,
        content: notice.content,
        contentHash: noticeContentHash(
          notice.title,
          notice.content,
          notice.attachmentUrls,
        ),
        observedAt,
        metadata,
      } satisfies RawItem;
    });
  }

  listErrors(): Array<{ sourceUri?: string; message: string }> {
    return [...this.errors];
  }

  private async loadDetail(notice: ParsedSchoolNotice): Promise<ParsedSchoolNotice> {
    const detailRecipe = this.options.recipe?.detail;
    if (detailRecipe === undefined) return notice;
    const html = await this.options.loadHtml(notice.uri);
    const detail = parseSchoolNoticeDetailHtml(html, notice.uri, detailRecipe);
    return {
      ...notice,
      content: detail.content || notice.content,
      attachmentUrls: [...new Set([...notice.attachmentUrls, ...detail.attachmentUrls])],
    };
  }
}

export * from "./parser.ts";
export * from "./types.ts";
export * from "./http-loader.ts";

function stableRawItemId(sourceId: string, externalId: string): string {
  const digest = createHash("sha256")
    .update(`${sourceId}\0${externalId}`, "utf8")
    .digest("hex")
    .slice(0, 16);
  return `raw-school-site-${digest}`;
}

function noticeContentHash(
  title: string,
  content: string,
  attachmentUrls: string[],
): string {
  return createHash("sha256")
    .update(JSON.stringify({ title, content, attachmentUrls }), "utf8")
    .digest("hex");
}
