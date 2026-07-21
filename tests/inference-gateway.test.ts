import assert from "node:assert/strict";
import test from "node:test";

import type { GatewayConfig } from "../apps/inference-gateway/src/config.ts";
import { createGatewayRuntime } from "../apps/inference-gateway/src/server.ts";
import {
  LLMExtractionError,
  RemoteJobLLMProvider,
  type LLMJSONRequest,
  type LLMProvider,
} from "../packages/context-engine/src/index.ts";

const resultSchema = {
  type: "object" as const,
  required: ["answer"],
  properties: { answer: { type: "string" as const } },
};

test("Gateway는 health를 공개하고 추론 Job은 인증한다", async () => {
  await withGateway(returningProvider({ answer: "ok" }), async (baseUrl) => {
    const health = await fetch(`${baseUrl}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: "ok" });

    const unauthorized = await fetch(`${baseUrl}/v1/inference/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(remoteRequest()),
    });
    assert.equal(unauthorized.status, 401);
  });
});

test("설치 코드는 한 번만 기기 Token으로 교환된다", async () => {
  await withGateway(returningProvider({ answer: "ok" }), async (baseUrl) => {
    const first = await fetch(`${baseUrl}/v1/auth/activate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ activationCode: "install-code", deviceName: "test-device" }),
    });
    assert.equal(first.status, 201);
    const payload = await first.json() as { token: string; tokenType: string };
    assert.match(payload.token, /^dodo_/);
    assert.equal(payload.tokenType, "Bearer");

    const second = await fetch(`${baseUrl}/v1/auth/activate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ activationCode: "install-code" }),
    });
    assert.equal(second.status, 409);
  });
});

test("RemoteJobLLMProvider는 Job 생성·polling·Schema 검증을 끝까지 수행한다", async () => {
  const requests: LLMJSONRequest<unknown>[] = [];
  const provider: LLMProvider = {
    async completeJSON<T>(request: LLMJSONRequest<T>): Promise<T> {
      requests.push(request as LLMJSONRequest<unknown>);
      return { answer: "원격 결과" } as T;
    },
  };

  await withGateway(provider, async (baseUrl) => {
    const remote = new RemoteJobLLMProvider({
      baseUrl,
      token: "bootstrap-token",
      defaultTimeoutMs: 5_000,
      sleepImplementation: () => new Promise((resolve) => setImmediate(resolve)),
    });
    const result = await remote.completeJSON({
      modelKind: "text",
      systemPrompt: "JSON으로 답하세요",
      userPrompt: "테스트",
      schema: resultSchema,
      temperature: 0,
      validate: (value): value is { answer: string } => (
        typeof value === "object" && value !== null && typeof (value as { answer?: unknown }).answer === "string"
      ),
    });

    assert.deepEqual(result, { answer: "원격 결과" });
    assert.equal(requests.length, 1);
    assert.equal(requests[0]!.modelKind, "text");
    assert.equal(requests[0]!.temperature, 0);
  });
});

test("Gateway는 허용하지 않는 모델 종류와 잘못된 Schema를 거부한다", async () => {
  await withGateway(returningProvider({ answer: "ok" }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/inference/jobs`, {
      method: "POST",
      headers: {
        authorization: "Bearer bootstrap-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({ ...remoteRequest(), modelKind: "arbitrary-model", schema: { type: "null" } }),
    });
    assert.equal(response.status, 400);
    const payload = await response.json() as { error: { code: string } };
    assert.equal(payload.error.code, "invalid_request");
  });
});

test("Gateway는 동시 요청에서도 활성 Job 수가 Queue 상한을 넘지 않는다", async () => {
  let releaseProvider!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseProvider = resolve;
  });
  const blockingProvider: LLMProvider = {
    async completeJSON<T>(): Promise<T> {
      await gate;
      return { answer: "ok" } as T;
    },
  };
  const config = { ...testConfig(), maxQueueSize: 2 };

  await withGateway(blockingProvider, async (baseUrl) => {
    try {
      const responses = await Promise.all(Array.from({ length: 12 }, () => (
        fetch(`${baseUrl}/v1/inference/jobs`, {
          method: "POST",
          headers: {
            authorization: "Bearer bootstrap-token",
            "content-type": "application/json",
          },
          body: JSON.stringify(remoteRequest()),
        })
      )));

      assert.equal(responses.filter((response) => response.status === 202).length, 2);
      const rejected = responses.filter((response) => response.status === 503);
      assert.equal(rejected.length, 10);
      for (const response of rejected) {
        const payload = await response.json() as { error: { code: string } };
        assert.equal(payload.error.code, "queue_full");
      }
    } finally {
      releaseProvider();
    }
  }, config);
});

test("Gateway의 재시도 가능 LLM 오류가 RemoteJobLLMProvider까지 보존된다", async () => {
  const failing: LLMProvider = {
    async completeJSON(): Promise<never> {
      throw new LLMExtractionError("GPU가 잠시 사용 중입니다", { category: "rate_limited" });
    },
  };

  await withGateway(failing, async (baseUrl) => {
    const remote = new RemoteJobLLMProvider({
      baseUrl,
      token: "bootstrap-token",
      defaultTimeoutMs: 5_000,
      sleepImplementation: () => new Promise((resolve) => setImmediate(resolve)),
    });
    await assert.rejects(
      remote.completeJSON({
        modelKind: "text",
        systemPrompt: "system",
        userPrompt: "user",
        schema: resultSchema,
        validate: (value): value is { answer: string } => typeof value === "object" && value !== null,
      }),
      (error: unknown) => error instanceof LLMExtractionError
        && error.category === "rate_limited"
        && error.retryable,
    );
  });
});

test("RemoteJobLLMProvider는 polling 중 일시적인 502 뒤 같은 Job을 다시 조회한다", async () => {
  let call = 0;
  const responses = [
    new Response(JSON.stringify({ jobId: "job_retry", status: "queued", pollAfterMs: 1 }), {
      status: 202,
      headers: { "content-type": "application/json" },
    }),
    new Response(JSON.stringify({
      error: { code: "tunnel_error", message: "temporary tunnel failure", retryable: true },
    }), {
      status: 502,
      headers: { "content-type": "application/json" },
    }),
    new Response(JSON.stringify({
      jobId: "job_retry",
      status: "succeeded",
      result: { answer: "재조회 성공" },
      createdAt: "2026-07-21T00:00:00.000Z",
      updatedAt: "2026-07-21T00:00:01.000Z",
      expiresAt: "2026-07-21T00:30:00.000Z",
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  ];
  const remote = new RemoteJobLLMProvider({
    baseUrl: "https://llm.example.test",
    token: "token",
    defaultTimeoutMs: 5_000,
    fetchImplementation: (async () => responses[call++]!) as typeof fetch,
    sleepImplementation: () => Promise.resolve(),
  });

  const result = await remote.completeJSON({
    modelKind: "text",
    systemPrompt: "system",
    userPrompt: "user",
    schema: resultSchema,
    validate: (value): value is { answer: string } => (
      typeof value === "object" && value !== null && typeof (value as { answer?: unknown }).answer === "string"
    ),
  });

  assert.deepEqual(result, { answer: "재조회 성공" });
  assert.equal(call, 3);
});

function remoteRequest(): Record<string, unknown> {
  return {
    modelKind: "text",
    systemPrompt: "system",
    userPrompt: "user",
    schema: resultSchema,
    temperature: 0,
  };
}

function returningProvider(value: unknown): LLMProvider {
  return {
    async completeJSON<T>(): Promise<T> {
      return value as T;
    },
  };
}

async function withGateway(
  provider: LLMProvider,
  run: (baseUrl: string) => Promise<void>,
  config: GatewayConfig = testConfig(),
): Promise<void> {
  const runtime = createGatewayRuntime(config, { provider });
  const address = await runtime.listen();
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await runtime.close();
  }
}

function testConfig(): GatewayConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    databasePath: ":memory:",
    ollamaBaseUrl: "http://127.0.0.1:11434",
    textModel: "text-model",
    visionModel: "vision-model",
    ollamaTimeoutMs: 5_000,
    maxConcurrentJobs: 1,
    maxQueueSize: 8,
    maxJobAttemptsPerDay: 20,
    jobTtlMs: 60_000,
    pollAfterMs: 1,
    maxTextBytes: 10_000,
    maxImageBytes: 10_000,
    maxImages: 1,
    maxSchemaBytes: 10_000,
    maxBodyBytes: 50_000,
    bootstrapTokens: ["bootstrap-token", "other-token"],
    activationCodes: ["install-code"],
  };
}
