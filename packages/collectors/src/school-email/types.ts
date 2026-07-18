export interface SchoolEmailInput {
  raw: string | Buffer;
  sourceUri?: string;
}

export interface SchoolEmailAttachment {
  filename?: string;
  contentType: string;
  size: number;
  contentId?: string;
  checksum: string;
}

export interface ParsedSchoolEmail {
  messageId: string;
  from: string;
  to: string[];
  subject?: string;
  receivedAt?: string;
  content: string;
  attachments: SchoolEmailAttachment[];
}

export interface SchoolEmailCollectionError {
  sourceUri?: string;
  message: string;
}
