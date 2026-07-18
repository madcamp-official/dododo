import type { Fact, FactExtractor, RawItem } from "../../../shared/src/index.ts";

export class NoopFactExtractor implements FactExtractor {
  async extract(_rawItem: RawItem): Promise<Fact[]> {
    return [];
  }
}
