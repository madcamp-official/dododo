import type { RawItem } from "../../../shared/src/index.ts";
import { BaseCollector } from "../base.ts";

export class SchoolSiteCollector extends BaseCollector {
  constructor(sourceId = "school-site") {
    super(sourceId, "school-site");
  }

  async sync(): Promise<RawItem[]> {
    throw new Error("SchoolSiteCollector is not implemented yet");
  }
}
