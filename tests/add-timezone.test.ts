import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const addTsUrl = pathToFileURL(join(repoRoot, "apps/desktop/src/main/ipc/add.ts")).href;
const containerTsUrl = pathToFileURL(join(repoRoot, "apps/cli/src/runtime/container.ts")).href;

// doyeonid 리뷰(PR #61): submitAdd의 결과가 실행 환경의 TZ에 의존하지 않는지는 같은
// 프로세스 안에서 process.env.TZ만 바꿔서는 안전하게 검증할 수 없다(Date의 로컬 시간
// 계산이 V8/ICU 캐시에 영향을 받을 수 있다) — 실제로 서로 다른 TZ로 새 프로세스를
// 띄워 비교해야 신뢰할 수 있는 회귀 테스트가 된다.
test("submitAdd는 실행 환경의 TZ와 무관하게 같은 startAt(Asia/Seoul, +09:00)을 저장한다", () => {
  const outputs = ["UTC", "Asia/Seoul", "America/New_York"].map((tz) => {
    const script = `
      import { submitAdd } from ${JSON.stringify(addTsUrl)};
      import { createCliContainer } from ${JSON.stringify(containerTsUrl)};
      const container = createCliContainer({ databasePath: ":memory:" });
      const result = await submitAdd(container, { title: "약속", date: "2026-07-25", time: "14:00" });
      if (!result.ok) throw new Error("submitAdd 실패: " + JSON.stringify(result));
      const saved = await container.repository.findContextItem(result.data.id);
      process.stdout.write(JSON.stringify({ startAt: saved.startAt }));
    `;
    return execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      env: { ...process.env, TZ: tz },
      encoding: "utf8",
    });
  });

  const startAts = outputs.map((output) => (JSON.parse(output) as { startAt: string }).startAt);
  assert.deepEqual(new Set(startAts).size, 1, `TZ별 결과가 서로 다름: ${JSON.stringify(startAts)}`);
  assert.equal(startAts[0], "2026-07-25T14:00:00+09:00");
});
