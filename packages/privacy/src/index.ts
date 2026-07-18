import type { PrivacyGateway, RawItem, SourceType } from "../../shared/src/index.ts";

export class AllowlistPrivacyGateway implements PrivacyGateway {
  private readonly allowedSources: Set<SourceType>;

  constructor(allowedSources: SourceType[]) {
    this.allowedSources = new Set(allowedSources);
  }

  async prepare(rawItem: RawItem): Promise<RawItem> {
    if (!this.allowedSources.has(rawItem.sourceType)) {
      throw new Error(`Source is not allowed: ${rawItem.sourceType}`);
    }

    return structuredClone(rawItem);
  }
}
