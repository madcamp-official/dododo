import assert from "node:assert/strict";
import test from "node:test";

import { listSchoolSiteItems } from "../apps/desktop/src/main/ipc/sourceItems.ts";
import { InMemoryRawItemRepository } from "../packages/storage/src/index.ts";

test("학교 사이트 수집 항목을 UI용 안전한 길이로 조회한다", async () => {
  const rawItemRepository = new InMemoryRawItemRepository();
  await rawItemRepository.save({
    id: "raw-site", sourceId: "school-site-main", sourceType: "school-site", externalId: "notice-1",
    uri: "https://school.example/notices/1", title: "장학금 공지", content: "가".repeat(4_001),
    contentHash: "hash", observedAt: "2026-07-22T01:00:00Z", metadata: {},
  });
  const result = await listSchoolSiteItems({ rawItemRepository });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.items[0]?.content.length, 4_000);
  assert.equal(result.data.items[0]?.truncated, true);
  assert.equal(result.data.items[0]?.uri, "https://school.example/notices/1");
});
