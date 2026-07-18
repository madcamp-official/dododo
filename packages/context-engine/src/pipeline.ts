import type {
  Collector,
  ContextRepository,
  ContextResolver,
  FactExtractor,
  PrivacyGateway,
  SyncResult,
} from "../../shared/src/index.ts";

export interface ContextPipelineDependencies {
  repository: ContextRepository;
  privacyGateway: PrivacyGateway;
  factExtractor: FactExtractor;
  contextResolver: ContextResolver;
}

export class ContextPipeline {
  private readonly dependencies: ContextPipelineDependencies;

  constructor(dependencies: ContextPipelineDependencies) {
    this.dependencies = dependencies;
  }

  async sync(collector: Collector): Promise<SyncResult> {
    try {
      const rawItems = await collector.sync();
      await this.dependencies.repository.saveRawItems(rawItems);

      const existing = await this.dependencies.repository.listContextItems();
      let created = 0;

      for (const rawItem of rawItems) {
        const safeItem = await this.dependencies.privacyGateway.prepare(rawItem);
        const facts = await this.dependencies.factExtractor.extract(safeItem);
        await this.dependencies.repository.saveFacts(facts);
        const resolved = await this.dependencies.contextResolver.resolve(facts, existing);
        await this.dependencies.repository.saveContextItems(resolved);
        existing.push(...resolved);
        created += resolved.length;
      }

      return {
        sourceId: collector.sourceId,
        collected: rawItems.length,
        created,
        updated: 0,
        skipped: rawItems.length - created,
        errors: [],
      };
    } catch (error) {
      return {
        sourceId: collector.sourceId,
        collected: 0,
        created: 0,
        updated: 0,
        skipped: 0,
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }
}
