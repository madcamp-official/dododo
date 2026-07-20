import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import { resolveDbPath } from "../apps/cli/src/runtime/dbConfig.ts";

test("resolveDbPath는 DODODO_DB_PATH 미설정이면 undefined를 반환한다(InMemory 폴백)", () => {
  assert.equal(resolveDbPath({}), undefined);
  assert.equal(resolveDbPath({ DODODO_DB_PATH: "" }), undefined);
  assert.equal(resolveDbPath({ DODODO_DB_PATH: "   " }), undefined);
});

test("resolveDbPath는 상대경로를 cwd 기준 절대경로로 바꾼다", () => {
  const path = resolveDbPath({ DODODO_DB_PATH: "./data/context.db" }, process.cwd());
  assert.equal(path, resolve(process.cwd(), "./data/context.db"));
});

test("resolveDbPath는 절대경로를 그대로 쓴다", () => {
  const absolute = resolve(process.cwd(), "elsewhere/context.db");
  const path = resolveDbPath({ DODODO_DB_PATH: absolute }, process.cwd());
  assert.equal(path, absolute);
});
