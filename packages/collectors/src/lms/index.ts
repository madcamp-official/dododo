import type { RawItem } from "../../../shared/src/index.ts";
import { BaseCollector } from "../base.ts";

export class LmsCollector extends BaseCollector {
  constructor(sourceId = "lms") {
    super(sourceId, "lms");
  }

  async sync(): Promise<RawItem[]> {
    throw new Error("LmsCollector is not implemented yet");
  }
}
