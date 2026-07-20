import { DatabaseSync } from "node:sqlite";

import { initializeContextSchema, initializeRawItemSchema } from "./schema.ts";

export function openRawItemDatabase(path = ":memory:"): DatabaseSync {
  const database = new DatabaseSync(path);
  database.exec("PRAGMA foreign_keys = ON;");
  initializeRawItemSchema(database);
  initializeContextSchema(database);
  return database;
}

export const openContextDatabase = openRawItemDatabase;
