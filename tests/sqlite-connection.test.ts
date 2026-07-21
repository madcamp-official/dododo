import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { openContextDatabase, openRawItemDatabase } from "../packages/storage/src/index.ts";

test("SQLite 연결은 동시 쓰기를 위해 busy_timeout을 설정한다", () => {
  const database = openRawItemDatabase();
  try {
    const row = database.prepare("PRAGMA busy_timeout").get() as { timeout: number };
    assert.equal(row.timeout, 5000);
  } finally {
    database.close();
  }
});

test("같은 SQLite 파일을 여러 Context 연결이 열어도 대기 정책이 같다", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dododo-sqlite-connection-"));
  const path = join(directory, "context.db");
  const first = openContextDatabase(path);
  const second = openContextDatabase(path);
  try {
    const firstRow = first.prepare("PRAGMA busy_timeout").get() as { timeout: number };
    const secondRow = second.prepare("PRAGMA busy_timeout").get() as { timeout: number };
    assert.equal(firstRow.timeout, 5000);
    assert.equal(secondRow.timeout, 5000);
  } finally {
    second.close();
    first.close();
    await rm(directory, { recursive: true, force: true });
  }
});
