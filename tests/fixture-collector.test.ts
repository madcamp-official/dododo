import assert from "node:assert/strict";
import test from "node:test";

import {
  JsonFixtureCollector,
  parseRawItem,
} from "../packages/collectors/src/index.ts";

test("school-site JSON Fixture를 RawItem으로 읽는다", async () => {
  const collector = new JsonFixtureCollector(
    "school-site-main",
    "school-site",
    ["fixtures/school-site/ai-hackathon.json"],
  );
  const items = await collector.sync();

  assert.equal(items.length, 1);
  assert.equal(items[0]?.sourceType, "school-site");
  assert.equal(items[0]?.externalId, "notice-1542");
  assert.match(items[0]?.content ?? "", /AI 해커톤/);
});

test("LMS JSON Fixture를 RawItem으로 읽는다", async () => {
  const collector = new JsonFixtureCollector(
    "lms-main",
    "lms",
    ["fixtures/lms/os-assignment.json"],
  );
  const [item] = await collector.sync();

  assert.equal(item?.title, "운영체제 과제 3");
  assert.equal(item?.externalId, "course-os-assignment-3");
});

test("LMS 시험과 마감 수정 Fixture가 동일 RawItem 계약을 사용한다", async () => {
  const currentCollector = new JsonFixtureCollector(
    "lms-main",
    "lms",
    ["fixtures/lms/os-assignment.json", "fixtures/lms/os-exam.json"],
  );
  const updateCollector = new JsonFixtureCollector(
    "lms-main",
    "lms",
    ["fixtures/lms/updates/os-assignment-extended.json"],
  );

  const current = await currentCollector.sync();
  const [updatedAssignment] = await updateCollector.sync();
  const exam = current.find((item) => item.externalId === "course-os-exam-final");
  const assignment = current.find((item) => item.externalId === "course-os-assignment-3");

  assert.equal(exam?.metadata.category, "exam");
  assert.equal(exam?.metadata.startAt, "2026-07-23T14:00:00+09:00");
  assert.equal(updatedAssignment?.id, assignment?.id);
  assert.equal(updatedAssignment?.externalId, assignment?.externalId);
  assert.notEqual(updatedAssignment?.contentHash, assignment?.contentHash);
  assert.equal(updatedAssignment?.metadata.dueAt, "2026-07-23T18:00:00+09:00");
});

test("Collector와 Fixture의 Source가 다르면 거부한다", async () => {
  const collector = new JsonFixtureCollector(
    "wrong-source",
    "school-site",
    ["fixtures/school-site/ai-hackathon.json"],
  );

  await assert.rejects(() => collector.sync(), /sourceId 불일치/);
});

test("필수 RawItem 필드가 빠지면 거부한다", () => {
  assert.throws(
    () => parseRawItem({ sourceType: "lms" }, "inline-test"),
    /id은 비어 있지 않은 문자열/,
  );
});

test("존재하지 않는 Fixture 경로는 파일 경로를 포함해 보고한다", async () => {
  const collector = new JsonFixtureCollector(
    "lms-main",
    "lms",
    ["fixtures/lms/not-found.json"],
  );

  await assert.rejects(
    () => collector.sync(),
    /Fixture를 읽을 수 없습니다 \(fixtures\/lms\/not-found\.json\)/,
  );
});
