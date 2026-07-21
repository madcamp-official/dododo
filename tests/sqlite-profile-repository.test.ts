import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { UserProfile } from "../packages/shared/src/index.ts";
import { openContextDatabase, SQLiteProfileRepository } from "../packages/storage/src/index.ts";

function profile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    school: "한국대학교",
    major: "컴퓨터공학과",
    year: "3학년",
    interests: ["AI", "공모전"],
    activityTypes: ["해커톤", "스터디"],
    preferredLocations: ["서울", "온라인"],
    explicitConstraints: ["평일 저녁만 가능"],
    ...overrides,
  };
}

test("SQLite ProfileRepository는 저장 전 undefined를 반환한다", async () => {
  const database = openContextDatabase();
  const repository = new SQLiteProfileRepository(database);
  assert.equal(await repository.get(), undefined);
});

test("SQLite ProfileRepository는 Quiet Hours를 포함해 왕복 저장한다", async () => {
  const database = openContextDatabase();
  const repository = new SQLiteProfileRepository(database);
  const saved = profile({ quietHours: { start: "22:00", end: "08:00" } });

  await repository.save(saved);
  const loaded = await repository.get();

  assert.deepEqual(loaded, saved);
});

test("SQLite ProfileRepository는 Quiet Hours 미설정을 undefined로 왕복한다", async () => {
  const database = openContextDatabase();
  const repository = new SQLiteProfileRepository(database);
  const saved = profile();

  await repository.save(saved);
  const loaded = await repository.get();

  assert.equal(loaded?.quietHours, undefined);
  assert.deepEqual(loaded, saved);
});

test("SQLite ProfileRepository는 단일 행을 upsert하고 이전 값을 덮어쓴다", async () => {
  const database = openContextDatabase();
  const repository = new SQLiteProfileRepository(database);

  await repository.save(profile({ major: "컴퓨터공학과" }));
  await repository.save(profile({ major: "전자공학과", interests: ["로봇"] }));

  const loaded = await repository.get();
  assert.equal(loaded?.major, "전자공학과");
  assert.deepEqual(loaded?.interests, ["로봇"]);

  const rowCount = (database.prepare("SELECT COUNT(*) AS count FROM user_profile").get() as { count: number }).count;
  assert.equal(rowCount, 1);
});

test("SQLite ProfileRepository는 DB 재시작 후에도 프로필을 유지한다", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dododo-profile-sqlite-"));
  const path = join(directory, "profile.db");
  try {
    const firstDatabase = openContextDatabase(path);
    await new SQLiteProfileRepository(firstDatabase).save(profile());
    firstDatabase.close();

    const secondDatabase = openContextDatabase(path);
    try {
      const loaded = await new SQLiteProfileRepository(secondDatabase).get();
      assert.equal(loaded?.school, "한국대학교");
      assert.deepEqual(loaded?.activityTypes, ["해커톤", "스터디"]);
    } finally {
      secondDatabase.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
