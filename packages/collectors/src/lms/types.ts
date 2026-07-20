export interface LmsHtmlInput {
  html: string;
  sourceUri: string;
}

export interface LmsHtmlSelectors {
  item: string;
  externalId?: string;
  course?: string;
  category?: string;
  title: string;
  content?: string;
  publishedAt?: string;
  dueAt?: string;
  link?: string;
}

export interface ParsedLmsItem {
  externalId: string;
  course?: string;
  category?: string;
  title: string;
  content: string;
  publishedAt?: string;
  dueAt?: string;
  uri: string;
}

export interface LmsCollectionError {
  sourceUri: string;
  itemIndex?: number;
  message: string;
}
