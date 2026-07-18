import type { Collector, RawItem, SourceType } from "../../shared/src/index.ts";

export abstract class BaseCollector implements Collector {
  readonly sourceId: string;
  readonly sourceType: SourceType;

  constructor(sourceId: string, sourceType: SourceType) {
    this.sourceId = sourceId;
    this.sourceType = sourceType;
  }

  abstract sync(): Promise<RawItem[]>;
}

export class FixtureCollector extends BaseCollector {
  private readonly items: RawItem[];

  constructor(sourceId: string, sourceType: SourceType, items: RawItem[]) {
    super(sourceId, sourceType);
    this.items = items;
  }

  async sync(): Promise<RawItem[]> {
    return structuredClone(this.items);
  }
}
