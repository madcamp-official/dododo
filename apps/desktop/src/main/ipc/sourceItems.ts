import type { CliContainer } from "../../../../cli/src/runtime/container.ts";
import { toResult } from "./result.ts";

const MAX_ITEMS = 50;
const MAX_CONTENT_LENGTH = 4_000;

export function listSchoolSiteItems(container: Pick<CliContainer, "rawItemRepository">) {
  return toResult(async () => {
    const rawItems = await container.rawItemRepository.listBySourceType("school-site", MAX_ITEMS);
    return {
      items: rawItems.map((item) => ({
        id: item.id,
        title: item.title ?? "제목 없는 수집 항목",
        uri: item.uri,
        observedAt: item.observedAt,
        content: item.content.slice(0, MAX_CONTENT_LENGTH),
        truncated: item.content.length > MAX_CONTENT_LENGTH,
      })),
    };
  });
}
