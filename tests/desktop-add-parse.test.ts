import assert from "node:assert/strict";
import test from "node:test";

import { parseNaturalLanguageSchedule } from "../apps/desktop/src/main/ipc/add.ts";
import { handleAddParse } from "../apps/desktop/src/main/ipc/handlers.ts";
import { createCliContainer } from "../apps/cli/src/runtime/container.ts";

const NOW = new Date("2026-07-20T10:00:00+09:00");

test("parseNaturalLanguageSchedule은 빈 문장을 거절한다", async () => {
  const container = createCliContainer({ databasePath: ":memory:" });
  const result = await parseNaturalLanguageSchedule(container, "   ", NOW);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "validation");
});

test("parseNaturalLanguageSchedule은 명확한 일정 문장을 폼 필드로 변환한다", async () => {
  const container = createCliContainer({ databasePath: ":memory:" });
  const result = await parseNaturalLanguageSchedule(
    container,
    "이번주 금요일 19시에 민수랑 저녁 약속 있어",
    NOW,
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.data, {
    title: "민수랑 저녁 약속",
    date: "2026-07-24",
    time: "19:00",
  });
});

test("parseNaturalLanguageSchedule은 시각이 모호하면 확인 안내를 함께 돌려준다", async () => {
  const container = createCliContainer({ databasePath: ":memory:" });
  const result = await parseNaturalLanguageSchedule(
    container,
    "내일 저녁에 카페에서 미팅",
    NOW,
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.date, "2026-07-21");
  assert.equal(result.data.time, "19:00");
  assert.match(result.data.ambiguousNote ?? "", /확인한 뒤 저장/);
});

test("parseNaturalLanguageSchedule은 시작~종료 범위를 endTime까지 채운다", async () => {
  const container = createCliContainer({ databasePath: ":memory:" });
  const result = await parseNaturalLanguageSchedule(
    container,
    "내일 오후 2시부터 4시까지 스터디",
    NOW,
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.time, "14:00");
  assert.equal(result.data.endTime, "16:00");
});

test("parseNaturalLanguageSchedule은 의도를 못 알아들으면 unrecognized 코드로 실패한다", async () => {
  const container = createCliContainer({ databasePath: ":memory:" });
  const result = await parseNaturalLanguageSchedule(container, "아무 말이나 던짐", NOW);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "unrecognized");
});

test("handleAddParse는 utterance가 문자열이 아니면 validation으로 거절한다", async () => {
  const container = createCliContainer({ databasePath: ":memory:" });
  const result = await handleAddParse(container, { utterance: 123 });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "validation");
});

test("handleAddParse는 유효한 문장을 parseNaturalLanguageSchedule에 그대로 전달한다", async () => {
  const container = createCliContainer({ databasePath: ":memory:" });
  const result = await handleAddParse(container, { utterance: "이번주 금요일 19시에 민수랑 저녁 약속 있어" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.title, "민수랑 저녁 약속");
});
