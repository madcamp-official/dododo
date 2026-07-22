import type { DatabaseSync, StatementSync } from "node:sqlite";

import type { RawItem, SourceType } from "../../../shared/src/index.ts";
import type {
  RawItemRepository,
  RawItemSaveResult,
} from "../raw-item-repository.ts";

export class SQLiteRawItemRepository implements RawItemRepository {
  private readonly findByIdStatement: StatementSync;
  private readonly findByExternalIdStatement: StatementSync;
  private readonly findByUriStatement: StatementSync;
  private readonly insertStatement: StatementSync;
  private readonly updateStatement: StatementSync;
  private readonly listBySourceTypeStatement: StatementSync;

  constructor(database: DatabaseSync) {
    this.findByIdStatement = database.prepare(`${SELECT_RAW_ITEM} WHERE id = ?`);
    this.findByExternalIdStatement = database.prepare(
      `${SELECT_RAW_ITEM} WHERE source_id = ? AND external_id = ?`,
    );
    this.findByUriStatement = database.prepare(
      `${SELECT_RAW_ITEM} WHERE source_id = ? AND uri = ? AND external_id IS NULL`,
    );
    this.insertStatement = database.prepare(`
      INSERT INTO raw_items (
        id, source_id, source_type, external_id, uri, title,
        content, content_hash, observed_at, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.updateStatement = database.prepare(`
      UPDATE raw_items
      SET source_id = ?,
          source_type = ?,
          external_id = ?,
          uri = ?,
          title = ?,
          content = ?,
          content_hash = ?,
          observed_at = ?,
          metadata_json = ?
      WHERE id = ?
    `);
    this.listBySourceTypeStatement = database.prepare(
      `${SELECT_RAW_ITEM} WHERE source_type = ? ORDER BY observed_at DESC, id ASC LIMIT ?`,
    );
  }

  async save(item: RawItem): Promise<RawItemSaveResult> {
    const existing = await this.findExisting(item);

    if (existing === undefined) {
      const itemWithSameId = await this.findById(item.id);
      if (itemWithSameId !== undefined) {
        throw new Error(`이미 다른 RawItem이 사용 중인 id입니다: ${item.id}`);
      }

      this.insert(item);
      return { item: structuredClone(item), status: "created" };
    }

    if (existing.contentHash === item.contentHash) {
      return { item: existing, status: "skipped" };
    }

    const updatedItem: RawItem = {
      ...structuredClone(item),
      id: existing.id,
    };
    this.update(updatedItem);

    return {
      item: structuredClone(updatedItem),
      status: "updated",
      previousHash: existing.contentHash,
    };
  }

  async findById(id: string): Promise<RawItem | undefined> {
    return rowToRawItem(this.findByIdStatement.get(id));
  }

  async findByExternalId(
    sourceId: string,
    externalId: string,
  ): Promise<RawItem | undefined> {
    return rowToRawItem(this.findByExternalIdStatement.get(sourceId, externalId));
  }

  async findByUri(sourceId: string, uri: string): Promise<RawItem | undefined> {
    return rowToRawItem(this.findByUriStatement.get(sourceId, uri));
  }

  async listBySourceType(sourceType: SourceType, limit: number): Promise<RawItem[]> {
    return this.listBySourceTypeStatement
      .all(sourceType, Math.max(0, limit))
      .map((row) => rowToRawItem(row))
      .filter((item): item is RawItem => item !== undefined);
  }

  private async findExisting(item: RawItem): Promise<RawItem | undefined> {
    return item.externalId === undefined
      ? this.findByUri(item.sourceId, item.uri)
      : this.findByExternalId(item.sourceId, item.externalId);
  }

  private insert(item: RawItem): void {
    this.insertStatement.run(
      item.id,
      item.sourceId,
      item.sourceType,
      item.externalId ?? null,
      item.uri,
      item.title ?? null,
      item.content,
      item.contentHash,
      item.observedAt,
      JSON.stringify(item.metadata),
    );
  }

  private update(item: RawItem): void {
    const result = this.updateStatement.run(
      item.sourceId,
      item.sourceType,
      item.externalId ?? null,
      item.uri,
      item.title ?? null,
      item.content,
      item.contentHash,
      item.observedAt,
      JSON.stringify(item.metadata),
      item.id,
    );

    if (result.changes !== 1) {
      throw new Error(`RawItem 수정 대상이 존재하지 않습니다: ${item.id}`);
    }
  }
}

const SELECT_RAW_ITEM = `
  SELECT id, source_id, source_type, external_id, uri, title,
         content, content_hash, observed_at, metadata_json
  FROM raw_items
`;

interface RawItemRow {
  id: string;
  source_id: string;
  source_type: string;
  external_id: string | null;
  uri: string;
  title: string | null;
  content: string;
  content_hash: string;
  observed_at: string;
  metadata_json: string;
}

function rowToRawItem(row: unknown): RawItem | undefined {
  if (row === undefined) return undefined;
  const value = row as RawItemRow;

  return {
    id: value.id,
    sourceId: value.source_id,
    sourceType: value.source_type as SourceType,
    externalId: value.external_id ?? undefined,
    uri: value.uri,
    title: value.title ?? undefined,
    content: value.content,
    contentHash: value.content_hash,
    observedAt: value.observed_at,
    metadata: parseMetadata(value.metadata_json),
  };
}

function parseMetadata(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("SQLite RawItem의 metadata_json이 객체가 아닙니다");
  }
  return parsed as Record<string, unknown>;
}
