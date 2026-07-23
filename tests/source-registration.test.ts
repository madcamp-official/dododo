import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  isRegisteredSourceType,
  listRegisteredSources,
  registerSchoolSiteSource,
  removeRegisteredSource,
} from "../apps/cli/src/runtime/sourceRegistration.ts";

// DODODO_SOURCE_CONFIG로 명시한 경로가 실제로 존재해야(내용은 빈 객체) 테스트별로
// 격리된 파일을 쓰면서도 "명시 경로가 없으면 에러"(doyeonid 리뷰 PR #67 1번) 정책과
// 부딪히지 않는다 — 그 정책 자체를 검증하는 테스트는 따로 존재하지 않는 경로를 쓴다.
async function tempConfigEnv(): Promise<{ env: NodeJS.ProcessEnv; cleanup: () => Promise<void> }> {
  const directory = await mkdtemp(join(tmpdir(), "dododo-source-registration-"));
  const configPath = join(directory, "dododo.sources.json");
  await writeFile(configPath, "{}\n", "utf8");
  return {
    env: { DODODO_SOURCE_CONFIG: configPath },
    cleanup: async () => { await rm(directory, { recursive: true, force: true }); },
  };
}

test("registerSchoolSiteSource는 빈 설정 파일에 schoolSite 배열을 새로 쓴다", async () => {
  const { env, cleanup } = await tempConfigEnv();
  try {
    const path = registerSchoolSiteSource("https://school.example/notices", env);
    const written = JSON.parse(await readFile(path, "utf8"));
    assert.deepEqual(written.schoolSite, [{ url: "https://school.example/notices" }]);
  } finally {
    await cleanup();
  }
});

test("registerSchoolSiteSource는 기존 설정의 다른 타입은 보존하고 schoolSite에 추가한다", async () => {
  const { env, cleanup } = await tempConfigEnv();
  try {
    // doyeonid 리뷰(PR #67) 지적: "다른 타입 보존" 테스트인데 실제로는 schoolEmail/lms를
    // 전혀 포함하지 않았다 — 유효한 schoolEmail/lms를 실제로 넣어서 검증한다.
    await writeFile(env.DODODO_SOURCE_CONFIG as string, JSON.stringify({
      schoolEmail: { inputDirectory: "./mail", allowedSenderDomains: ["school.example"] },
      lms: {
        baseUrl: "https://lms.example",
        inputPaths: ["./lms/notice.html"],
        selectors: { item: ".item", title: ".title" },
      },
    }), "utf8");

    registerSchoolSiteSource("https://old.example", env);
    const path = registerSchoolSiteSource("https://new.example", env);
    const written = JSON.parse(await readFile(path, "utf8"));

    // 여러 학교 사이트를 동시에 등록할 수 있어야 하므로 새 URL이 기존 URL을
    // 대체하지 않고 배열에 추가된다. 두 번째 항목부터는 URL에서 파생한
    // sourceId가 자동으로 붙는다.
    assert.equal(written.schoolSite.length, 2);
    assert.equal(written.schoolSite[0].url, "https://old.example");
    assert.equal(written.schoolSite[1].url, "https://new.example");
    assert.equal(written.schoolSite[1].sourceId, "school-site-new.example");
    assert.equal(written.schoolEmail.inputDirectory, "./mail");
    assert.deepEqual(written.schoolEmail.allowedSenderDomains, ["school.example"]);
    assert.equal(written.lms.baseUrl, "https://lms.example");
  } finally {
    await cleanup();
  }
});

test("registerSchoolSiteSource는 같은 URL을 다시 등록해도 중복 항목을 만들지 않는다", async () => {
  const { env, cleanup } = await tempConfigEnv();
  try {
    registerSchoolSiteSource("https://school.example", env);
    const path = registerSchoolSiteSource("https://school.example", env);
    const written = JSON.parse(await readFile(path, "utf8"));
    assert.equal(written.schoolSite.length, 1);
  } finally {
    await cleanup();
  }
});

test("registerSchoolSiteSource는 유효하지 않은 URL을 거절한다", async () => {
  const { env, cleanup } = await tempConfigEnv();
  try {
    assert.throws(() => registerSchoolSiteSource("not-a-url", env), /유효한 URL/);
  } finally {
    await cleanup();
  }
});

test("listRegisteredSources는 빈 설정 파일이면 빈 배열을 반환한다", async () => {
  const { env, cleanup } = await tempConfigEnv();
  try {
    assert.deepEqual(listRegisteredSources(env), []);
  } finally {
    await cleanup();
  }
});

// doyeonid 리뷰(PR #67) 1번: 기본 경로(DODODO_SOURCE_CONFIG 미설정)에서만 "파일
// 없음 = 빈 설정"이 허용된다 — 명시 경로가 없으면 오타를 조용히 숨기지 않고 에러다.
test("listRegisteredSources는 명시한 경로에 파일이 없으면 에러를 던진다(기본 경로는 예외)", () => {
  const missingExplicitPath = join(tmpdir(), "dododo-source-registration-missing", "dododo.sources.json");
  assert.throws(
    () => listRegisteredSources({ DODODO_SOURCE_CONFIG: missingExplicitPath }),
    /찾을 수 없습니다/,
  );
});

test("listRegisteredSources는 등록된 schoolSite를 반환한다", async () => {
  const { env, cleanup } = await tempConfigEnv();
  try {
    registerSchoolSiteSource("https://school.example", env);
    assert.deepEqual(
      listRegisteredSources(env),
      [{ id: "school-site", type: "school-site", value: "https://school.example" }],
    );
  } finally {
    await cleanup();
  }
});

test("listRegisteredSources는 예전 형식(단일 객체) schoolSite도 읽고, 등록으로 두 번째 항목을 추가할 수 있다", async () => {
  const { env, cleanup } = await tempConfigEnv();
  try {
    await writeFile(env.DODODO_SOURCE_CONFIG as string, JSON.stringify({
      schoolSite: { url: "https://old-format.example" },
    }), "utf8");

    assert.deepEqual(
      listRegisteredSources(env),
      [{ id: "school-site", type: "school-site", value: "https://old-format.example" }],
    );

    registerSchoolSiteSource("https://new.example", env);
    assert.deepEqual(listRegisteredSources(env), [
      { id: "school-site", type: "school-site", value: "https://old-format.example" },
      { id: "school-site-new.example", type: "school-site", value: "https://new.example" },
    ]);
  } finally {
    await cleanup();
  }
});

test("listRegisteredSources는 등록된 schoolSite 여러 개를 각각 고유 id로 반환한다", async () => {
  const { env, cleanup } = await tempConfigEnv();
  try {
    registerSchoolSiteSource("https://a.example", env);
    registerSchoolSiteSource("https://b.example", env);
    assert.deepEqual(listRegisteredSources(env), [
      { id: "school-site", type: "school-site", value: "https://a.example" },
      { id: "school-site-b.example", type: "school-site", value: "https://b.example" },
    ]);
  } finally {
    await cleanup();
  }
});

// doyeonid 리뷰(PR #67) 2번: enabled:false는 필수 필드(url 등)가 없어도 검증을
// 통과하므로(validateSourceInputConfig가 건너뜀) 목록에서도 제외해야
// value: undefined인 항목이 새어 나가지 않는다.
test("listRegisteredSources는 enabled:false Source를 목록에서 제외한다", async () => {
  const { env, cleanup } = await tempConfigEnv();
  try {
    await writeFile(env.DODODO_SOURCE_CONFIG as string, JSON.stringify({
      schoolSite: [{ enabled: false }], // url 없음 — enabled:false라 검증도 건너뜀
    }), "utf8");

    assert.deepEqual(listRegisteredSources(env), []);
  } finally {
    await cleanup();
  }
});

// doyeonid 리뷰(PR #67) 2번: enabled:false가 아닌데 필수 필드가 없는 설정은
// 조용히 undefined 값을 만들지 않고 읽는 시점(list/remove)에도 에러로 드러나야 한다.
test("listRegisteredSources는 필수 필드가 빠진 활성 Source가 있으면 에러를 던진다", async () => {
  const { env, cleanup } = await tempConfigEnv();
  try {
    await writeFile(env.DODODO_SOURCE_CONFIG as string, JSON.stringify({
      schoolSite: [{}], // enabled 명시 안 함(기본 활성) + url 없음
    }), "utf8");

    assert.throws(() => listRegisteredSources(env), /schoolSite\.url/);
  } finally {
    await cleanup();
  }
});

test("removeRegisteredSource는 등록된 항목을 지우고 true를 반환한다", async () => {
  const { env, cleanup } = await tempConfigEnv();
  try {
    registerSchoolSiteSource("https://school.example", env);
    const removed = removeRegisteredSource("school-site", env);
    assert.equal(removed, true);
    assert.deepEqual(listRegisteredSources(env), []);
  } finally {
    await cleanup();
  }
});

test("removeRegisteredSource는 여러 schoolSite 중 지정한 항목만 지운다", async () => {
  const { env, cleanup } = await tempConfigEnv();
  try {
    registerSchoolSiteSource("https://a.example", env);
    registerSchoolSiteSource("https://b.example", env);

    const removed = removeRegisteredSource("school-site-b.example", env);
    assert.equal(removed, true);
    assert.deepEqual(
      listRegisteredSources(env),
      [{ id: "school-site", type: "school-site", value: "https://a.example" }],
    );
  } finally {
    await cleanup();
  }
});

test("removeRegisteredSource는 등록되지 않은 항목이면 false를 반환하고 파일을 건드리지 않는다", async () => {
  const { env, cleanup } = await tempConfigEnv();
  try {
    const removed = removeRegisteredSource("lms", env);
    assert.equal(removed, false);
  } finally {
    await cleanup();
  }
});

test("isRegisteredSourceType은 school-site/school-email/lms만 허용한다", () => {
  assert.equal(isRegisteredSourceType("school-site"), true);
  assert.equal(isRegisteredSourceType("school-email"), true);
  assert.equal(isRegisteredSourceType("lms"), true);
  assert.equal(isRegisteredSourceType("file"), false);
  assert.equal(isRegisteredSourceType("screen"), false);
  assert.equal(isRegisteredSourceType(undefined), false);
  assert.equal(isRegisteredSourceType(123), false);
});
