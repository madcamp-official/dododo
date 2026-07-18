import type { RawItem } from "../../../shared/src/index.ts";
import { BaseCollector } from "../base.ts";

export class CalendarCollector extends BaseCollector {
  constructor(sourceId = "calendar") {
    super(sourceId, "calendar");
  }

  async sync(): Promise<RawItem[]> {
    throw new Error("CalendarCollector is not implemented yet");
  }
}
