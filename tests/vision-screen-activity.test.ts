import assert from "node:assert/strict";
import test from "node:test";

import {
  extractScreenActivity,
  linkActivityToContext,
} from "../packages/context-engine/src/index.ts";
import type { LLMJSONRequest, LLMProvider } from "../packages/context-engine/src/index.ts";
import type { ContextItem } from "../packages/shared/src/index.ts";

const OBSERVED_AT = new Date("2026-07-21T10:00:00+09:00");
const IMAGE_BASE64 = "ZmFrZS1zY3JlZW5zaG90LWJ5dGVz"; // "fake-screenshot-bytes"

function recordingProvider(
  response: unknown,
): { provider: LLMProvider; requests: LLMJSONRequest<unknown>[] } {
  const requests: LLMJSONRequest<unknown>[] = [];
  return {
    requests,
    provider: {
      async completeJSON<T>(request: LLMJSONRequest<T>): Promise<T> {
        requests.push(request as LLMJSONRequest<unknown>);
        if (!request.validate(response)) throw new Error("invalid");
        return response as T;
      },
    },
  };
}

const failingProvider: LLMProvider = {
  async completeJSON() {
    throw new Error("Vision 모델 호출 실패");
  },
};

test("extractScreenActivity는 modelKind: vision과 images 배열로 요청한다", async () => {
  const { provider, requests } = recordingProvider({
    application: "VS Code",
    activityType: "코딩",
    course: "운영체제",
    section: "3주차",
    taskCandidate: "운영체제 과제 3",
    sensitiveContentDetected: false,
    confidence: 0.8,
  });

  await extractScreenActivity({ imageBase64: IMAGE_BASE64, observedAt: OBSERVED_AT, provider });

  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.modelKind, "vision");
  assert.deepEqual(requests[0]?.images, [IMAGE_BASE64]);
});

test("extractScreenActivity는 유효한 응답을 fixture와 같은 metadata 키를 가진 RawItem으로 바꾼다", async () => {
  const { provider } = recordingProvider({
    application: "VS Code",
    activityType: "코딩",
    course: "운영체제",
    section: "3주차",
    taskCandidate: "운영체제 과제 3",
    sensitiveContentDetected: false,
    confidence: 0.8,
  });

  const result = await extractScreenActivity({ imageBase64: IMAGE_BASE64, observedAt: OBSERVED_AT, provider });

  assert.equal(result.outcome, "extracted");
  if (result.outcome !== "extracted") return;
  assert.equal(result.activity.sourceType, "screen");
  assert.equal(result.activity.title, "VS Code");
  assert.equal(result.activity.content, "코딩 · 운영체제 · 3주차");
  assert.equal(result.activity.metadata.applicationHint, "VS Code");
  assert.equal(result.activity.metadata.confidence, 0.8);
  assert.equal(result.activity.metadata.relatedTaskCandidate, "운영체제 과제 3");
  // imageBase64 원본은 반환값 어디에도 남지 않는다.
  assert.equal(JSON.stringify(result.activity).includes(IMAGE_BASE64), false);
});

test("extractScreenActivity는 course/section이 없으면 activityType만으로 content를 만든다", async () => {
  const { provider } = recordingProvider({
    application: "Chrome",
    activityType: "웹 서핑",
    sensitiveContentDetected: false,
    confidence: 0.6,
  });

  const result = await extractScreenActivity({ imageBase64: IMAGE_BASE64, observedAt: OBSERVED_AT, provider });

  assert.equal(result.outcome, "extracted");
  if (result.outcome !== "extracted") return;
  assert.equal(result.activity.content, "웹 서핑");
  assert.equal(result.activity.metadata.relatedTaskCandidate, undefined);
});

test("extractScreenActivity는 민감한 내용이 감지되면 RawItem을 만들지 않는다", async () => {
  const { provider } = recordingProvider({
    application: "카카오톡",
    activityType: "메시지 확인",
    sensitiveContentDetected: true,
    confidence: 0.9,
  });

  const result = await extractScreenActivity({ imageBase64: IMAGE_BASE64, observedAt: OBSERVED_AT, provider });

  assert.deepEqual(result, { outcome: "sensitive_content" });
});

test("extractScreenActivity는 Provider 실패 시 failed를 반환한다", async () => {
  const result = await extractScreenActivity({
    imageBase64: IMAGE_BASE64,
    observedAt: OBSERVED_AT,
    provider: failingProvider,
  });

  assert.deepEqual(result, { outcome: "failed" });
});

test("extractScreenActivity는 confidence가 범위를 벗어난 무효 응답이면 failed를 반환한다", async () => {
  const { provider } = recordingProvider({
    application: "VS Code",
    activityType: "코딩",
    sensitiveContentDetected: false,
    confidence: 1.5,
  });

  const result = await extractScreenActivity({ imageBase64: IMAGE_BASE64, observedAt: OBSERVED_AT, provider });

  assert.deepEqual(result, { outcome: "failed" });
});

test("extractScreenActivity 결과는 기존 linkActivityToContext와 그대로 연동된다", async () => {
  const { provider } = recordingProvider({
    application: "VS Code",
    activityType: "코딩",
    taskCandidate: "운영체제 과제 3",
    sensitiveContentDetected: false,
    confidence: 0.8,
  });
  const task: ContextItem = {
    id: "ctx-os-3",
    kind: "task",
    title: "운영체제 과제 3 보고서 작성",
    status: "new",
    requirements: [],
    tags: ["task"],
    priority: 0,
    confidence: 0.9,
    evidenceIds: ["ev-1"],
    metadata: {},
    createdAt: OBSERVED_AT.toISOString(),
    updatedAt: OBSERVED_AT.toISOString(),
  };

  const result = await extractScreenActivity({ imageBase64: IMAGE_BASE64, observedAt: OBSERVED_AT, provider });
  assert.equal(result.outcome, "extracted");
  if (result.outcome !== "extracted") return;

  const link = linkActivityToContext(result.activity, [task], OBSERVED_AT);
  assert.equal(link?.item.id, "ctx-os-3");
});
