import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { renderDoctor } from "../apps/cli/src/commands/doctor.ts";
import { renderInbox } from "../apps/cli/src/commands/inbox.ts";
import { runSync } from "../apps/cli/src/commands/sync.ts";
import { createCliContainer } from "../apps/cli/src/runtime/container.ts";

// 이 파일의 존재 이유: issue #27이 "가장 큰 병목"이라 부른 문제 — sync를 실행한
// 프로세스가 끝나면 InMemory 저장소도 같이 사라져서, 별도 프로세스의 inbox/today가
// 아무것도 못 봤다. DODODO_DB_PATH를 설정하면 이 시나리오가 실제로 해결되는지
// container를 새로 만들어(=프로세스 재시작 흉내) 증명한다.
test("sync 후 container를 새로 만들어도(프로세스 재시작 흉내) inbox가 Context를 유지한다", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dododo-cli-persistence-"));
  const dbPath = join(directory, "context.db");
  const options = { databasePath: dbPath };

  try {
    const first = createCliContainer(options);
    assert.equal(first.dbPath, dbPath);
    await runSync(first);

    const opportunitiesBeforeRestart = await first.repository.listContextItems("opportunity");
    assert.ok(opportunitiesBeforeRestart.length >= 1, "sync 직후에는 최소 1건 있어야 함");
    first.close();

    const second = createCliContainer(options);
    try {
      const inbox = await renderInbox(second);
      assert.match(inbox, /Opportunity Inbox/);

      const opportunitiesAfterRestart = await second.repository.listContextItems("opportunity");
      assert.deepEqual(
        opportunitiesAfterRestart.map((item) => item.id).sort(),
        opportunitiesBeforeRestart.map((item) => item.id).sort(),
        "재시작 후에도 같은 Opportunity가 그대로 조회돼야 함",
      );
    } finally {
      second.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("doctor는 DODODO_DB_PATH 미설정이면 기본 영속 경로(SQLite)를 보여준다", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dododo-doctor-default-storage-"));
  const cwd = process.cwd();
  try {
    process.chdir(directory);
    const container = createCliContainer({});
    try {
      assert.match(await renderDoctor(container), /Storage: SQLite \(.*\.dododo[\\/]dododo\.db\)/);
    } finally {
      container.close();
    }
  } finally {
    process.chdir(cwd);
    await rm(directory, { recursive: true, force: true });
  }
});

test("doctor는 DODODO_DB_PATH=:memory:이면 in-memory 상태를 보여준다", async () => {
  const container = createCliContainer({ databasePath: ":memory:" });
  try {
    assert.match(await renderDoctor(container), /Storage: in-memory \(DODODO_DB_PATH=:memory:\)/);
  } finally {
    container.close();
  }
});

test("doctor는 DODODO_DB_PATH 설정이면 SQLite 경로를 보여준다", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dododo-doctor-storage-"));
  const dbPath = join(directory, "context.db");
  try {
    const container = createCliContainer({ databasePath: dbPath });
    try {
      assert.match(await renderDoctor(container), new RegExp(`Storage: SQLite`));
    } finally {
      container.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("createCliContainer의 databasePath 옵션은 DODODO_DB_PATH보다 우선한다(#43/#45와 시그니처 통일, PR #40 리뷰)", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dododo-databasepath-override-"));
  const envDbPath = join(directory, "from-env.db");
  const optionDbPath = join(directory, "from-option.db");
  try {
    const container = createCliContainer({
      databasePath: optionDbPath,
      env: { DODODO_DB_PATH: envDbPath },
    });
    try {
      assert.equal(container.dbPath, optionDbPath);
    } finally {
      container.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("doctor는 Source 설정 파일이 없으면 Fixture 데모 상태를 보여준다", async () => {
  const container = createCliContainer({ databasePath: ":memory:" });
  try {
    assert.match(await renderDoctor(container), /Sources: Fixture 데모/);
  } finally {
    container.close();
  }
});

test("doctor는 Source 설정 파일이 잘못됐으면 Fixture로 폴백하되 오류를 보여준다", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dododo-doctor-sources-"));
  const configPath = join(directory, "dododo.sources.json");
  try {
    await writeFile(configPath, "{ not json");
    const container = createCliContainer({
      databasePath: ":memory:",
      env: { DODODO_SOURCES_CONFIG_PATH: configPath },
    });
    try {
      assert.match(await renderDoctor(container), /Sources: 설정 오류 — Fixture로 폴백 중/);
      const sourceIds = container.collectors.map((collector) => collector.sourceId).sort();
      assert.deepEqual(sourceIds, ["lms-main", "school-email-main", "school-site-main"]);

      // doctor를 따로 실행해야만 원인이 보이면 위험하다 — sync 출력 맨 위에도 경고가
      // 있어야 "수집 N건" 성공 메시지만 보고 실제 학교 데이터인 줄 착각하지 않는다
      // (PR #40 리뷰, 김도현 지적).
      const syncOutput = await runSync(container);
      assert.match(syncOutput.split("\n")[0]!, /^dododo sync$/);
      assert.match(syncOutput.split("\n")[1]!, /경고: Source 설정 오류로 Fixture 데모 데이터를 수집 중입니다/);
    } finally {
      container.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
