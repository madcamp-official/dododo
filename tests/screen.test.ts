import assert from "node:assert/strict";
import test from "node:test";

import { runScreen } from "../apps/cli/src/commands/screen.ts";
import { createCliContainer } from "../apps/cli/src/runtime/container.ts";
import { captureActiveScreen } from "../packages/collectors/src/screen/capture.ts";
import { ScreenCollector } from "../packages/collectors/src/screen/index.ts";
import { parseScreenFixture, toRawItem } from "../packages/collectors/src/screen/transform.ts";

const FIXTURE_PATH = "fixtures/screen/os-study.json";
const FIXTURE_JSON = {
  observedAt: "2026-07-18T15:20:00+09:00",
  applicationHint: "PDF Viewer",
  activity: "운영체제 교재의 프로세스 스케줄링 단원을 공부 중",
  relatedTaskCandidate: "운영체제 시험 대비",
  confidence: 0.82,
};

test("parseScreenFixture는 정상 fixture를 파싱한다", () => {
  const parsed = parseScreenFixture(FIXTURE_JSON, FIXTURE_PATH);
  assert.equal(parsed.applicationHint, "PDF Viewer");
  assert.match(parsed.activity, /프로세스 스케줄링/);
  assert.equal(parsed.confidence, 0.82);
});

test("parseScreenFixture는 필드 누락 시 경로를 포함해 던진다", () => {
  const { activity: _activity, ...withoutActivity } = FIXTURE_JSON;
  assert.throws(
    () => parseScreenFixture(withoutActivity, FIXTURE_PATH),
    new RegExp(FIXTURE_PATH.replaceAll("/", "\\/")),
  );
});

test("parseScreenFixture는 confidence 범위를 벗어나면 던진다", () => {
  assert.throws(() => parseScreenFixture({ ...FIXTURE_JSON, confidence: 1.5 }, FIXTURE_PATH));
});

test("toRawItem은 원본 캡처 없이 활동 요약만 담은 RawItem을 만든다", () => {
  const fixture = parseScreenFixture(FIXTURE_JSON, FIXTURE_PATH);
  const item = toRawItem(fixture, "screen-manual");

  assert.equal(item.sourceType, "screen");
  assert.equal(item.content, FIXTURE_JSON.activity);
  assert.equal(item.metadata.confidence, 0.82);
  assert.equal(item.metadata.relatedTaskCandidate, "운영체제 시험 대비");
  assert.equal(JSON.stringify(item).includes("base64"), false);
});

test("toRawItem의 id는 메타데이터가 바뀌어도 안정적이다(observedAt 기반)", () => {
  const fixture = parseScreenFixture(FIXTURE_JSON, FIXTURE_PATH);
  const original = toRawItem(fixture, "screen-manual");
  const confidenceChanged = toRawItem({ ...fixture, confidence: 0.4 }, "screen-manual");

  assert.equal(original.id, confidenceChanged.id);
});

test("toRawItem의 contentHash는 activity가 같아도 다른 메타데이터가 바뀌면 변한다", () => {
  const fixture = parseScreenFixture(FIXTURE_JSON, FIXTURE_PATH);
  const original = toRawItem(fixture, "screen-manual");

  assert.notEqual(original.contentHash, toRawItem({ ...fixture, confidence: 0.4 }, "screen-manual").contentHash);
  assert.notEqual(
    original.contentHash,
    toRawItem({ ...fixture, relatedTaskCandidate: "다른 과목" }, "screen-manual").contentHash,
  );
  assert.notEqual(
    original.contentHash,
    toRawItem({ ...fixture, applicationHint: "다른 앱" }, "screen-manual").contentHash,
  );
});

test("ScreenCollector는 fixture 경로들을 읽어 RawItem으로 변환한다", async () => {
  const collector = new ScreenCollector("screen-manual", [FIXTURE_PATH]);
  const items = await collector.sync();

  assert.equal(items.length, 1);
  assert.equal(items[0]?.sourceType, "screen");
  assert.equal(items[0]?.title, "PDF Viewer");
});

test("ScreenCollector는 존재하지 않는 경로에서 경로를 포함한 오류를 던진다", async () => {
  const collector = new ScreenCollector("screen-manual", ["fixtures/screen/does-not-exist.json"]);
  await assert.rejects(
    () => collector.sync(),
    /fixtures\/screen\/does-not-exist\.json/,
  );
});

test("runScreen은 fixtures/screen을 privacy allowlist 오류 없이 동기화한다", async () => {
  const container = createCliContainer({ databasePath: ":memory:" });

  const output = await runScreen(container, new Date("2026-07-20T10:00:00+09:00"));

  assert.match(output, /dododo screen/);
  assert.match(output, /수집 1/);
  assert.doesNotMatch(output, /Source is not allowed/);
  assert.doesNotMatch(output, /오류:/);
});

test("captureActiveScreen은 주입된 runner의 바이트를 base64로 감싼다", async () => {
  const fakeBytes = Buffer.from("fake-png-bytes");
  const result = await captureActiveScreen(
    async () => fakeBytes,
    () => new Date("2026-07-20T10:00:00+09:00"),
  );

  assert.equal(result.byteLength, fakeBytes.byteLength);
  assert.equal(result.imageBase64, fakeBytes.toString("base64"));
  assert.equal(result.capturedAt.toISOString(), new Date("2026-07-20T10:00:00+09:00").toISOString());
});

test("captureActiveScreen은 runner 실패를 그대로 전파한다", async () => {
  await assert.rejects(
    () => captureActiveScreen(async () => {
      throw new Error("캡처 명령 실패");
    }),
    /캡처 명령 실패/,
  );
});
