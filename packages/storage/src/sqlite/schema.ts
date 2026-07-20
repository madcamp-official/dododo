import type { DatabaseSync } from "node:sqlite";

export function initializeRawItemSchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS raw_items (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      external_id TEXT,
      uri TEXT NOT NULL,
      title TEXT,
      content TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      metadata_json TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS raw_items_source_external_id
      ON raw_items(source_id, external_id)
      WHERE external_id IS NOT NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS raw_items_source_uri_without_external_id
      ON raw_items(source_id, uri)
      WHERE external_id IS NULL;
  `);
}
