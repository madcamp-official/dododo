import { readFile } from "node:fs/promises";

import type { RawItem } from "../../../shared/src/index.ts";
import { BaseCollector } from "../base.ts";
import { parseScreenFixture, toRawItem } from "./transform.ts";

export * from "./capture.ts";
export * from "./transform.ts";

// 지금은 다른 세 Collector와 같은 단계(fixture-first)다. 나중에 실제 화면 캡처로
// 바뀌어도 sync(): Promise<RawItem[]> 계약은 그대로라 위쪽(container/CLI)은
// 영향받지 않는다.
export class ScreenCollector extends BaseCollector {
  private readonly fixturePaths: string[];

  constructor(sourceId = "screen", fixturePaths: string[] = []) {
    super(sourceId, "screen");
    this.fixturePaths = [...fixturePaths];
  }

  async sync(): Promise<RawItem[]> {
    const items: RawItem[] = [];
    for (const fixturePath of this.fixturePaths) {
      items.push(await this.readFixture(fixturePath));
    }
    return items;
  }

  private async readFixture(fixturePath: string): Promise<RawItem> {
    let content: string;
    try {
      content = await readFile(fixturePath, "utf8");
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`화면 활동 Fixture를 읽을 수 없습니다 (${fixturePath}): ${reason}`);
    }

    let value: unknown;
    try {
      value = JSON.parse(content) as unknown;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`화면 활동 Fixture JSON 파싱에 실패했습니다 (${fixturePath}): ${reason}`);
    }

    return toRawItem(parseScreenFixture(value, fixturePath), this.sourceId);
  }
}
