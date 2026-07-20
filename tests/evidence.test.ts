import assert from "node:assert/strict";
import test from "node:test";

import { runEvidence } from "../apps/cli/src/commands/evidence.ts";
import { createCliContainer } from "../apps/cli/src/runtime/container.ts";
import type { ContextItem, Evidence } from "../packages/shared/src/index.ts";

function taskItem(overrides: Partial<ContextItem> = {}): ContextItem {
  return {
    id: "task-os",
    kind: "task",
    title: "운영체제 과제 보고서 작성",
    status: "new",
    deadline: "2026-07-21T23:59:00+09:00",
    requirements: ["보고서"],
    tags: [],
    priority: 0,
    confidence: 0.9,
    evidenceIds: ["evidence-1"],
    metadata: {},
    createdAt: "2026-07-18T00:00:00+09:00",
    updatedAt: "2026-07-18T00:00:00+09:00",
    ...overrides,
  };
}

function evidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    id: "evidence-1",
    rawItemId: "raw-lms-001",
    sourceType: "lms",
    location: "https://lms.example/courses/os/assignments/3",
    quote: "과제 3은 2026년 7월 22일 23시 59분까지 제출합니다.",
    observedAt: "2026-07-18T09:20:00+09:00",
    authority: "official",
    ...overrides,
  };
}

test("evidence는 id가 없으면 사용법을 보여준다", async () => {
  const container = createCliContainer();
  const output = await runEvidence(container, []);
  assert.match(output, /사용법: dododo evidence/);
});

test("evidence는 존재하지 않는 id면 안내한다", async () => {
  const container = createCliContainer();
  const output = await runEvidence(container, ["ctx-없음"]);
  assert.match(output, /찾을 수 없습니다/);
});

test("evidence는 근거가 아직 없으면 안내한다", async () => {
  const container = createCliContainer();
  await container.repository.saveContextItems([taskItem({ evidenceIds: [] })]);

  const output = await runEvidence(container, ["task-os"]);
  assert.match(output, /근거를 찾을 수 없습니다/);
});

test("evidence는 원본 근거(출처·인용·관찰 시각)를 그대로 보여준다", async () => {
  const container = createCliContainer();
  await container.repository.saveContextItems([taskItem()]);
  await container.repository.saveEvidence([evidence()]);

  const output = await runEvidence(container, ["task-os"]);

  assert.match(output, /운영체제 과제 보고서 작성/);
  assert.match(output, /총 1건/);
  assert.match(output, /\[lms · official\]/);
  assert.match(output, /https:\/\/lms\.example\/courses\/os\/assignments\/3/);
  assert.match(output, /과제 3은 2026년 7월 22일 23시 59분까지 제출합니다\./);
});

test("evidence는 여러 Source의 근거를 모두 보여준다(병합된 Opportunity)", async () => {
  const container = createCliContainer();
  await container.repository.saveContextItems([
    taskItem({
      id: "ctx-merged",
      kind: "opportunity",
      evidenceIds: ["ev-site", "ev-email"],
    }),
  ]);
  await container.repository.saveEvidence([
    evidence({ id: "ev-site", sourceType: "school-site", location: "https://school.example/notice/1" }),
    evidence({ id: "ev-email", sourceType: "school-email", location: "email://school-email-main/1" }),
  ]);

  const output = await runEvidence(container, ["ctx-merged"]);

  assert.match(output, /총 2건/);
  assert.match(output, /school-site/);
  assert.match(output, /school-email/);
});
