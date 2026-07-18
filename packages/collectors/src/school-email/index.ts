import { createHash } from "node:crypto";

import type { RawItem } from "../../../shared/src/index.ts";
import { BaseCollector } from "../base.ts";
import { parseSchoolEmail } from "./parser.ts";
import type {
  SchoolEmailCollectionError,
  SchoolEmailInput,
} from "./types.ts";

export interface SchoolEmailCollectorOptions {
  sourceId?: string;
  allowedSenderDomains: string[];
  loadMessages: () => Promise<SchoolEmailInput[]>;
  maxMessageBytes?: number;
  now?: () => Date;
}

const DEFAULT_MAX_MESSAGE_BYTES = 5 * 1024 * 1024;

export class SchoolEmailCollector extends BaseCollector {
  private readonly options: SchoolEmailCollectorOptions;
  private errors: SchoolEmailCollectionError[] = [];

  constructor(options: SchoolEmailCollectorOptions) {
    super(options.sourceId ?? "school-email", "school-email");
    if (options.allowedSenderDomains.length === 0) {
      throw new Error("허용할 학교 이메일 도메인을 하나 이상 지정해야 합니다");
    }
    if (!Number.isInteger(options.maxMessageBytes ?? DEFAULT_MAX_MESSAGE_BYTES)
      || (options.maxMessageBytes ?? DEFAULT_MAX_MESSAGE_BYTES) <= 0) {
      throw new Error("maxMessageBytes는 0보다 큰 정수여야 합니다");
    }
    this.options = options;
  }

  async sync(): Promise<RawItem[]> {
    const inputs = await this.options.loadMessages();
    const observedAt = (this.options.now ?? (() => new Date()))().toISOString();
    const maxMessageBytes = this.options.maxMessageBytes ?? DEFAULT_MAX_MESSAGE_BYTES;
    const items: RawItem[] = [];
    this.errors = [];

    for (const input of inputs) {
      try {
        if (messageSize(input.raw) > maxMessageBytes) {
          throw new Error(`이메일이 허용 크기(${maxMessageBytes} bytes)를 초과했습니다`);
        }

        const email = await parseSchoolEmail(input.raw, this.options.allowedSenderDomains);
        if (email === undefined) continue;

        const metadata: Record<string, unknown> = {
          messageId: email.messageId,
          from: email.from,
          to: email.to,
          attachments: email.attachments,
          official: true,
        };
        if (email.receivedAt !== undefined) metadata.receivedAt = email.receivedAt;

        items.push({
          id: stableEmailId(this.sourceId, email.messageId),
          sourceId: this.sourceId,
          sourceType: this.sourceType,
          externalId: email.messageId,
          uri: emailUri(this.sourceId, email.messageId),
          title: email.subject,
          content: email.content,
          contentHash: emailContentHash(email),
          observedAt,
          metadata,
        });
      } catch (error) {
        this.errors.push({
          sourceUri: input.sourceUri,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return items;
  }

  listErrors(): SchoolEmailCollectionError[] {
    return structuredClone(this.errors);
  }
}

export * from "./parser.ts";
export * from "./types.ts";

function messageSize(raw: string | Buffer): number {
  return Buffer.isBuffer(raw) ? raw.byteLength : Buffer.byteLength(raw, "utf8");
}

function stableEmailId(sourceId: string, messageId: string): string {
  const digest = createHash("sha256")
    .update(`${sourceId}\0${messageId}`, "utf8")
    .digest("hex")
    .slice(0, 16);
  return `raw-school-email-${digest}`;
}

function emailUri(sourceId: string, messageId: string): string {
  return `email://${encodeURIComponent(sourceId)}/${encodeURIComponent(messageId)}`;
}

function emailContentHash(email: {
  subject?: string;
  content: string;
  attachments: unknown[];
}): string {
  return createHash("sha256")
    .update(JSON.stringify({
      subject: email.subject,
      content: email.content,
      attachments: email.attachments,
    }), "utf8")
    .digest("hex");
}
