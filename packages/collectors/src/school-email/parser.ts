import { simpleParser, type AddressObject } from "mailparser";

import type {
  ParsedSchoolEmail,
  SchoolEmailAttachment,
} from "./types.ts";

export async function parseSchoolEmail(
  raw: string | Buffer,
  allowedSenderDomains: string[],
): Promise<ParsedSchoolEmail | undefined> {
  const mail = await simpleParser(raw, {
    skipHtmlToText: false,
    skipTextToHtml: true,
    skipImageLinks: true,
  });
  const messageId = mail.messageId?.trim();
  if (!messageId) throw new Error("이메일 Message-ID가 없습니다");

  const from = firstAddress(mail.from);
  if (from === undefined) throw new Error(`이메일 발신자가 없습니다: ${messageId}`);
  if (!isAllowedSender(from, allowedSenderDomains)) return undefined;

  const content = normalizeEmailText(mail.text ?? "");
  if (!content) throw new Error(`이메일 본문이 비어 있습니다: ${messageId}`);

  return {
    messageId,
    from,
    to: addresses(mail.to),
    subject: optionalText(mail.subject),
    receivedAt: mail.date?.toISOString(),
    content,
    attachments: mail.attachments.map(toAttachmentMetadata),
  };
}

export function normalizeEmailText(value: string): string {
  return value.replaceAll(/\r\n?/g, "\n").replaceAll(/[ \t]+/g, " ").trim();
}

function firstAddress(value: AddressObject | undefined): string | undefined {
  return value?.value.find((entry) => entry.address !== undefined)?.address?.toLowerCase();
}

function addresses(value: AddressObject | AddressObject[] | undefined): string[] {
  const objects = value === undefined ? [] : Array.isArray(value) ? value : [value];
  return objects.flatMap((object) => object.value)
    .map((entry) => entry.address?.toLowerCase())
    .filter((address): address is string => address !== undefined);
}

function isAllowedSender(address: string, allowedDomains: string[]): boolean {
  const separator = address.lastIndexOf("@");
  if (separator < 0) return false;
  const senderDomain = address.slice(separator + 1);

  return allowedDomains.some((domain) => {
    const normalizedDomain = domain.trim().toLowerCase().replace(/^@/, "");
    return normalizedDomain !== ""
      && (senderDomain === normalizedDomain || senderDomain.endsWith(`.${normalizedDomain}`));
  });
}

function optionalText(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function toAttachmentMetadata(attachment: {
  filename?: string;
  contentType: string;
  size: number;
  contentId?: string;
  checksum: string;
}): SchoolEmailAttachment {
  return {
    filename: optionalText(attachment.filename),
    contentType: attachment.contentType,
    size: attachment.size,
    contentId: optionalText(attachment.contentId),
    checksum: attachment.checksum,
  };
}
