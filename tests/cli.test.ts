import assert from "node:assert/strict";
import test from "node:test";
import { Readable, Writable } from "node:stream";

import { renderDoctor } from "../apps/cli/src/commands/doctor.ts";
import { renderInbox } from "../apps/cli/src/commands/inbox.ts";
import { runSetup } from "../apps/cli/src/commands/setup.ts";
import { runSync } from "../apps/cli/src/commands/sync.ts";
import { renderToday } from "../apps/cli/src/commands/today.ts";
import { createCliContainer } from "../apps/cli/src/runtime/container.ts";

function discardOutput(): Writable {
  return new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
}

async function* pacedLines(lines: string[]): AsyncGenerator<string> {
  for (const line of lines) {
    await new Promise((resolve) => setImmediate(resolve));
    yield `${line}\n`;
  }
}

test("container loads fixture-backed collectors for school-site, school-email and lms", () => {
  const container = createCliContainer();
  const sourceIds = container.collectors.map((collector) => collector.sourceId).sort();
  assert.deepEqual(sourceIds, ["lms-main", "school-email-main", "school-site-main"]);
});

test("container keeps screenCollector separate from the auto-synced collectors", () => {
  const container = createCliContainer();
  assert.equal(container.screenCollector.sourceType, "screen");
  assert.equal(container.collectors.some((collector) => collector.sourceType === "screen"), false);
});

test("sync populates opportunities and tasks that inbox/today can render", async () => {
  const container = createCliContainer();
  const syncSummary = await runSync(container);
  assert.match(syncSummary, /school-site-main/);
  assert.equal(container.collectors.every((c) => container.syncStatus.get(c.sourceId) !== undefined), true);

  const opportunities = await container.repository.listContextItems("opportunity");
  const tasks = await container.repository.listContextItems("task");
  assert.ok(opportunities.length >= 1);
  assert.ok(tasks.length >= 1);

  const inbox = await renderInbox(container);
  assert.match(inbox, /Opportunity Inbox/);
  assert.match(inbox, /관련도/);

  const today = await renderToday(container);
  assert.match(today, /Today/);
});

test("doctor reports source status after sync", async () => {
  const container = createCliContainer();
  await runSync(container);

  const doctor = renderDoctor(container);
  assert.match(doctor, /Source 상태/);
  assert.match(doctor, /마지막 동기화/);
});

test("setup saves a profile collected from scripted stdin", async () => {
  const container = createCliContainer();
  const input = Readable.from(pacedLines([
    "테스트대학교",
    "컴퓨터공학",
    "3학년",
    "AI, 해커톤",
    "온라인",
    "서울",
  ]));
  const output = discardOutput();

  const summary = await runSetup(container, { input, output });
  assert.match(summary, /프로필이 저장되었습니다/);

  const profile = await container.profileRepository.get();
  assert.equal(profile?.school, "테스트대학교");
  assert.deepEqual(profile?.interests, ["AI", "해커톤"]);
});
