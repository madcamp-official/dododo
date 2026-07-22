import { DatabaseSync } from "node:sqlite";

import {
  initializeContextSchema,
  initializeJobSchema,
  initializeProfileSchema,
  initializeRawItemSchema,
} from "./schema.ts";

export function openRawItemDatabase(path = ":memory:"): DatabaseSync {
  const database = new DatabaseSync(path);
  // watch와 일회성 CLI 명령이 같은 파일 DB를 열 수 있다. 잠깐의 쓰기 잠금에
  // 즉시 SQLITE_BUSY로 실패하지 않고 제한된 시간동안 대기한다.
  database.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  initializeRawItemSchema(database);
  initializeContextSchema(database);
  initializeProfileSchema(database);
  initializeJobSchema(database);
  return database;
}

export const openContextDatabase = openRawItemDatabase;
