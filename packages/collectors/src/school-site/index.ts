import { createHash } from "node:crypto";

import type { RawItem } from "../../../shared/src/index.ts";
import { BaseCollector } from "../base.ts";
import { parseSchoolNoticeHtml } from "./parser.ts";
import type { SchoolSiteSelectors } from "./types.ts";

export interface SchoolSiteCollectorOptions {
  sourceId?: string;
  baseUrl: string;
  loadHtml: () => Promise<string>;
  selectors?: Partial<SchoolSiteSelectors>;
  now?: () => Date;
}

export class SchoolSiteCollector extends BaseCollector {
  private readonly options: SchoolSiteCollectorOptions;

  constructor(options: SchoolSiteCollectorOptions) {
    super(options.sourceId ?? "school-site", "school-site");
    this.options = options;
  }

  async sync(): Promise<RawItem[]> {
    const html = await this.options.loadHtml();
    const observedAt = (this.options.now ?? (() => new Date()))().toISOString();
    const notices = parseSchoolNoticeHtml(html, {
      baseUrl: this.options.baseUrl,
      selectors: this.options.selectors,
    });

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
