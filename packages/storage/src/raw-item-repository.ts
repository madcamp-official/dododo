import type { RawItem, SourceType } from "../../shared/src/index.ts";

export type RawItemSaveStatus = "created" | "updated" | "skipped";

export interface RawItemSaveResult {
  item: RawItem;
  status: RawItemSaveStatus;
  previousHash?: string;
}

export interface RawItemRepository {
  save(item: RawItem): Promise<RawItemSaveResult>;
  findById(id: string): Promise<RawItem | undefined>;
  findByExternalId(
    sourceId: string,
    externalId: string,
  ): Promise<RawItem | undefined>;
  findByUri(sourceId: string, uri: string): Promise<RawItem | undefined>;
  listBySourceType(sourceType: SourceType, limit: number): Promise<RawItem[]>;
}
