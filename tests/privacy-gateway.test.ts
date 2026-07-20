import assert from "node:assert/strict";
import test from "node:test";

import {
  ChunkingPrivacyGateway,
  maskSensitiveText,
  selectRelevantContent,
} from "../packages/privacy/src/index.ts";
import type { RawItem } from "../packages/shared/src/index.ts";

function rawItem(overrides: Partial<RawItem> = {}): RawItem {
  return {
    id: "raw-1",
    sourceId: "school-email-main",
    sourceType: "school-email",
    uri: "email://school-email-main/1",
    title: "장학금 안내",
    content: "안내드립니다.",
    contentHash: "hash-1",
    observedAt: "2026-07-18T09:00:00+09:00",
    metadata: {},
    ...overrides,
  };
}

test("maskSensitiveText는 개인정보를 가리고 정확히 허용한 공식 이메일만 보존한다", () => {
  const text = "문의 010-1234-5678, 학번 20231234, 개인 hong@gmail.com, 학생 student@school.ac.kr, 공식 support@school.ac.kr";
  const masked = maskSensitiveText(text, {
    allowedEmailAddresses: ["support@school.ac.kr"],
  });

  assert.match(masked, /\[전화번호\]/);
  assert.match(masked, /\[학번\]/);
  assert.match(masked, /\[이메일\]/);
  assert.doesNotMatch(masked, /010-1234-5678/);
  assert.doesNotMatch(masked, /hong@gmail\.com/);
  assert.doesNotMatch(masked, /student@school\.ac\.kr/);
  assert.match(masked, /support@school\.ac\.kr/, "명시적으로 허용한 공식 주소만 보존해야 한다");
});

test("maskSensitiveText는 주소 allowlist가 없으면 학교 도메인 이메일도 마스킹한다", () => {
  assert.equal(maskSensitiveText("student@school.ac.kr"), "[이메일]");
});

test("maskSensitiveText는 마감·요구사항 같은 Task 텍스트를 훼손하지 않는다", () => {
  const text = "신청 마감은 2026년 7월 25일 18시입니다. 보고서 2건을 제출하세요.";
  assert.equal(maskSensitiveText(text, {}), text);
});

test("maskSensitiveText는 구분자 유무와 관계없이 주민등록번호를 가린다", () => {
  const masked = maskSensitiveText("주민번호 990101-1234567, 외국인번호 990101 5123456, 연속형 9901013123456");

  assert.equal(masked, "주민번호 [주민등록번호], 외국인번호 [주민등록번호], 연속형 [주민등록번호]");
});

test("selectRelevantContent는 짧은 본문을 그대로 둔다", () => {
  const short = "신청 마감은 7월 25일입니다.";
  assert.equal(selectRelevantContent(short, { maxChars: 2000 }), short);
});

test("selectRelevantContent는 긴 본문을 예산 안으로 줄이되 마감 문단은 유지한다", () => {
  const filler = "일반적인 인사말과 배경 설명입니다. ".repeat(40);
  const long = [
    filler,
    "신청 마감은 2026년 7월 25일 18시이며 제출 요구사항을 확인하세요.",
    filler,
  ].join("\n\n");

  const selected = selectRelevantContent(long, { maxChars: 300 });

  assert.ok(selected.length <= 300, "예산 이내여야 한다");
  assert.match(selected, /2026년 7월 25일/, "마감이 담긴 문단은 유지해야 한다");
});

test("selectRelevantContent는 신호가 있는 단일 문단이 예산보다 길어도 상한을 지킨다", () => {
  const longParagraph = `신청 마감 제출 요구사항 ${"세부 안내 ".repeat(100)}`;
  const selected = selectRelevantContent(longParagraph, { maxChars: 80 });

  assert.ok(selected.length <= 80);
  assert.match(selected, /신청 마감/);
});

test("selectRelevantContent는 잘못된 문자 예산을 거부한다", () => {
  for (const maxChars of [0, -1, 1.5, Number.NaN]) {
    assert.throws(() => selectRelevantContent("본문", { maxChars }), /maxChars/);
  }
});

test("selectRelevantContent는 신호가 약하면 첫 문단과 제목 포함 문단을 보존한다", () => {
  const filler = "특별한 신호가 없는 문단입니다. ".repeat(40);
  const content = [
    "첫 문단 인사말입니다.",
    filler,
    "장학금 안내 세부 문단입니다.",
    filler,
  ].join("\n\n");

  const selected = selectRelevantContent(content, { maxChars: 200, title: "장학금 안내" });

  assert.match(selected, /첫 문단 인사말/);
  assert.match(selected, /장학금 안내 세부 문단/);
});

test("ChunkingPrivacyGateway는 허용되지 않은 Source를 거부한다", async () => {
  const gateway = new ChunkingPrivacyGateway({ allowedSources: ["school-email"] });
  await assert.rejects(
    () => gateway.prepare(rawItem({ sourceType: "lms" })),
    /Source is not allowed/,
  );
});

test("ChunkingPrivacyGateway는 화면 안전 사본의 자유 형식 metadata를 비운다", async () => {
  const gateway = new ChunkingPrivacyGateway({ allowedSources: ["screen"] });
  const original = rawItem({
    sourceType: "screen",
    metadata: {
      pngBase64: "iVBORw0KGgo...",
      capture: { screenshotBase64: "nested-image" },
      applicationHint: "PDF Viewer",
    },
  });

  const safe = await gateway.prepare(original);

  assert.deepEqual(safe.metadata, {});
  assert.notDeepEqual(original.metadata, {}, "원본 metadata는 변경하지 않는다");
});

test("ChunkingPrivacyGateway는 마스킹된 안전한 사본을 반환하고 원본은 건드리지 않는다", async () => {
  const gateway = new ChunkingPrivacyGateway({
    allowedSources: ["school-email"],
    allowedEmailAddresses: ["support@school.ac.kr"],
  });
  const original = rawItem({
    content: "담당자 010-9876-5432에게 신청 마감 2026년 7월 25일까지 제출하세요.",
  });
  const before = structuredClone(original);

  const safe = await gateway.prepare(original);

  assert.match(safe.content, /\[전화번호\]/);
  assert.match(safe.content, /2026년 7월 25일/, "마감 텍스트는 유지");
  assert.deepEqual(original, before, "원본 RawItem은 변경되면 안 된다");
});
