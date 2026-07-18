import type { RawItem } from "../../../shared/src/index.ts";
import { BaseCollector } from "../base.ts";

export class FileCollector extends BaseCollector {
  constructor(sourceId = "files") {
    super(sourceId, "file");
  }

  async sync(): Promise<RawItem[]> {
    throw new Error("FileCollector is not implemented yet");
  }
}
