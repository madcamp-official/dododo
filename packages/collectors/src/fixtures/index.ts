import { readFile } from "node:fs/promises";

import type { RawItem, SourceType } from "../../../shared/src/index.ts";
import { BaseCollector } from "../base.ts";
import { parseRawItem } from "./validator.ts";

export class JsonFixtureCollector extends BaseCollector {
  private readonly fixturePaths: string[];

  constructor(sourceId: string, sourceType: SourceType, fixturePaths: string[]) {
    super(sourceId, sourceType);

    if (fixturePaths.length === 0) {
      throw new Error("Fixture 경로를 하나 이상 지정해야 합니다");
    }

    this.fixturePaths = [...fixturePaths];
  }

  async sync(): Promise<RawItem[]> {
    const items: RawItem[] = [];
    const seenIds = new Set<string>();

    for (const fixturePath of this.fixturePaths) {
      const item = await this.readFixture(fixturePath);

      if (item.sourceId !== this.sourceId) {
        throw new Error(
          `Fixture sourceId 불일치 (${fixturePath}): ${item.sourceId} != ${this.sourceId}`,
        );
      }
      if (item.sourceType !== this.sourceType) {
        throw new Error(
          `Fixture sourceType 불일치 (${fixturePath}): ${item.sourceType} != ${this.sourceType}`,
        );
      }
      if (seenIds.has(item.id)) {
        throw new Error(`중복된 Fixture id (${fixturePath}): ${item.id}`);
      }

      seenIds.add(item.id);
      items.push(item);
    }

    return items;
  }

  private async readFixture(fixturePath: string): Promise<RawItem> {
    let content: string;
    try {
      content = await readFile(fixturePath, "utf8");
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Fixture를 읽을 수 없습니다 (${fixturePath}): ${reason}`);
    }

    let value: unknown;
    try {
      value = JSON.parse(content) as unknown;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Fixture JSON 파싱에 실패했습니다 (${fixturePath}): ${reason}`);
    }

    return parseRawItem(value, fixturePath);
  }
}

export { parseRawItem } from "./validator.ts";
