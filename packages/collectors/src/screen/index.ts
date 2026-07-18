import type { RawItem } from "../../../shared/src/index.ts";
import { BaseCollector } from "../base.ts";

export class ScreenCollector extends BaseCollector {
  constructor(sourceId = "screen") {
    super(sourceId, "screen");
  }

  async sync(): Promise<RawItem[]> {
    throw new Error("ScreenCollector is not implemented yet");
  }
}
