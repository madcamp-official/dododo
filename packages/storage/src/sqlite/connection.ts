import { DatabaseSync } from "node:sqlite";

import { initializeRawItemSchema } from "./schema.ts";

export function openRawItemDatabase(path = ":memory:"): DatabaseSync {
  const database = new DatabaseSync(path);
  database.exec("PRAGMA foreign_keys = ON;");
  initializeRawItemSchema(database);
  return database;
}
