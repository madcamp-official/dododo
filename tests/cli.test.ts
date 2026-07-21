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
  const container = createCliContainer({ databasePath: ":memory:" });
  const sourceIds = container.collectors.map((collector) => collector.sourceId).sort();
  assert.deepEqual(sourceIds, ["lms-main", "school-email-main", "school-site-main"]);
});

test("container keeps screenCollector separate from the auto-synced collectors", () => {
  const container = createCliContainer({ databasePath: ":memory:" });
  assert.equal(container.screenCollector.sourceType, "screen");
  assert.equal(container.collectors.some((collector) => collector.sourceType === "screen"), false);
});

test("privacyGateway는 conversation sourceType을 허용한다(ask/추천 문장 생성이 쓰는 합성 RawItem, PR #33 리뷰 반영)", async () => {
  const container = createCliContainer({ databasePath: ":memory:" });
  const prepared = await container.privacyGateway.prepare({
    id: "raw-conversation-1",
    sourceId: "conversation",
    sourceType: "conversation",
    uri: "conversation://test",
    content: "hello",
    contentHash: "ephemeral",
    observedAt: "2026-07-20T00:00:00+09:00",
    metadata: {},
  });
  assert.equal(prepared.sourceType, "conversation");
});

test("sync populates opportunities and tasks that inbox/today can render", async () => {
  const container = createCliContainer({ databasePath: ":memory:" });
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
  const container = createCliContainer({ databasePath: ":memory:" });
  await runSync(container);

  const doctor = await renderDoctor(container);
  assert.match(doctor, /Source 상태/);
  assert.match(doctor, /마지막 동기화/);
});

test("doctor는 DODODO_LLM_BASE_URL 미설정이면 미설정 문구를 보여준다", async () => {
  const container = createCliContainer({ databasePath: ":memory:" });
  const doctor = await renderDoctor(container);
  assert.match(doctor, /LLM: 미설정\(\.env의 DODODO_LLM_BASE_URL 없음\)/);
});

test("doctor는 baseUrl 설정+연결 성공이면 연결 OK를 보여준다", async () => {
  const container = createCliContainer({ databasePath: ":memory:" });
  container.llmConfig = {
    provider: "ollama",
    baseUrl: "http://vm:11434",
    textModel: "gemma3:12b",
    visionModel: "gemma3:4b",
    timeoutMs: 1_200_000,
  };
  const fakeFetch = (async () => new Response(null, { status: 200 })) as typeof fetch;

  const doctor = await renderDoctor(container, fakeFetch);
  assert.match(doctor, /LLM: http:\/\/vm:11434 · text=gemma3:12b vision=gemma3:4b · 연결 OK/);
});

test("doctor는 연결 실패 응답이면 HTTP 상태코드를 보여준다", async () => {
  const container = createCliContainer({ databasePath: ":memory:" });
  container.llmConfig = {
    provider: "ollama",
    baseUrl: "http://vm:11434",
    textModel: "gemma3:12b",
    visionModel: "gemma3:4b",
    timeoutMs: 1_200_000,
  };
  const fakeFetch = (async () => new Response(null, { status: 500 })) as typeof fetch;

  const doctor = await renderDoctor(container, fakeFetch);
  assert.match(doctor, /연결 실패\(HTTP 500\)/);
});

test("doctor는 fetch가 실패해도 죽지 않고 실패 사유를 보여준다", async () => {
  const container = createCliContainer({ databasePath: ":memory:" });
  container.llmConfig = {
    provider: "ollama",
    baseUrl: "http://vm:11434",
    textModel: "gemma3:12b",
    visionModel: "gemma3:4b",
    timeoutMs: 1_200_000,
  };
  const fakeFetch = (async () => {
    throw new Error("connect ECONNREFUSED");
  }) as typeof fetch;

  const doctor = await renderDoctor(container, fakeFetch);
  assert.match(doctor, /연결 실패\(connect ECONNREFUSED\)/);
});

test("doctor는 remote-job Provider에서 공개 health endpoint를 확인한다", async () => {
  const container = createCliContainer({ databasePath: ":memory:" });
  container.llmConfig = {
    provider: "remote-job",
    baseUrl: "https://llm.example.test",
    textModel: "gemma3:12b",
    visionModel: "gemma3:4b",
    token: "secret-not-rendered",
    timeoutMs: 1_200_000,
  };
  let requestedUrl = "";
  const fakeFetch = (async (input: string | URL | Request) => {
    requestedUrl = String(input);
    return new Response(null, { status: 200 });
  }) as typeof fetch;

  const doctor = await renderDoctor(container, fakeFetch);
  assert.equal(requestedUrl, "https://llm.example.test/health");
  assert.match(doctor, /LLM: remote-job https:\/\/llm\.example\.test · 연결 OK/);
  assert.doesNotMatch(doctor, /secret-not-rendered/);
});

test("setup saves a profile collected from scripted stdin", async () => {
  const container = createCliContainer({ databasePath: ":memory:" });
  const input = Readable.from(pacedLines([
    "테스트대학교",
    "컴퓨터공학",
    "3학년",
    "AI, 해커톤",
    "온라인",
    "서울",
    "",
  ]));
  const output = discardOutput();

  const summary = await runSetup(container, { input, output });
  assert.match(summary, /프로필이 저장되었습니다/);

  const profile = await container.profileRepository.get();
  assert.equal(profile?.school, "테스트대학교");
  assert.deepEqual(profile?.interests, ["AI", "해커톤"]);
  assert.equal(profile?.quietHours, undefined);
});

test("setup saves quietHours when both times are valid", async () => {
  const container = createCliContainer({ databasePath: ":memory:" });
  const input = Readable.from(pacedLines([
    "테스트대학교",
    "컴퓨터공학",
    "3학년",
    "AI, 해커톤",
    "온라인",
    "서울",
    "22:00",
    "07:00",
  ]));
  const output = discardOutput();

  const summary = await runSetup(container, { input, output });
  assert.doesNotMatch(summary, /Quiet Hours를 설정하지 않았습니다/);

  const profile = await container.profileRepository.get();
  assert.deepEqual(profile?.quietHours, { start: "22:00", end: "07:00" });
});

test("container has no llmProvider without DODODO_LLM_BASE_URL(회귀 없음 확인)", () => {
  assert.equal(process.env.DODODO_LLM_BASE_URL, undefined, "테스트 환경에 이 변수가 이미 설정돼 있으면 안 됨");
  const container = createCliContainer({ databasePath: ":memory:" });
  assert.equal(container.llmProvider, undefined);
});

test("DODODO_LLM_BASE_URL을 설정하면 container가 llmProvider를 갖고, LLM이 실패해도 sync는 안 죽는다", async () => {
  // 아무도 안 듣는 포트 — 연결 실패 유도. process.env를 건드리지 않고 container에
  // 직접 넘긴다 — createCliContainer(options)가 options.env를 resolveLlmConfig/
  // createLlmProvider에도 그대로 전달하므로(PR #40 리뷰 nit) process.env 변이 없이
  // 테스트할 수 있다.
  const container = createCliContainer({
    databasePath: ":memory:",
    env: { DODODO_LLM_BASE_URL: "http://127.0.0.1:1" },
  });
  assert.notEqual(container.llmProvider, undefined);

  const summary = await runSync(container);
  assert.match(summary, /school-site-main/);
});

test("setup skips quietHours and warns when the start time is malformed", async () => {
  const container = createCliContainer({ databasePath: ":memory:" });
  const input = Readable.from(pacedLines([
    "테스트대학교",
    "컴퓨터공학",
    "3학년",
    "AI, 해커톤",
    "온라인",
    "서울",
    "25:99",
  ]));
  const output = discardOutput();

  const summary = await runSetup(container, { input, output });
  assert.match(summary, /Quiet Hours를 설정하지 않았습니다/);

  const profile = await container.profileRepository.get();
  assert.equal(profile?.quietHours, undefined);
});
