import type { RawItem } from "../../../shared/src/index.ts";
import { BaseCollector } from "../base.ts";

export class SchoolEmailCollector extends BaseCollector {
  constructor(sourceId = "school-email") {
    super(sourceId, "school-email");
  }

  async sync(): Promise<RawItem[]> {
    throw new Error("SchoolEmailCollector is not implemented yet");
  }
}
