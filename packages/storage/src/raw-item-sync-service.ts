import type { RawItem } from "../../shared/src/index.ts";
import type {
  RawItemRepository,
  RawItemSaveResult,
} from "./raw-item-repository.ts";

export interface RawItemSyncError {
  rawItemId: string;
  message: string;
}

export interface RawItemSyncSummary {
  collected: number;
  created: number;
  updated: number;
  skipped: number;
  itemsToAnalyze: RawItem[];
  results: RawItemSaveResult[];
  errors: RawItemSyncError[];
}

export class RawItemSyncService {
  private readonly repository: RawItemRepository;

  constructor(repository: RawItemRepository) {
    this.repository = repository;
  }

  async sync(items: RawItem[]): Promise<RawItemSyncSummary> {
    const summary: RawItemSyncSummary = {
      collected: items.length,
      created: 0,
      updated: 0,
      skipped: 0,
      itemsToAnalyze: [],
      results: [],
      errors: [],
    };

    for (const item of items) {
      try {
        const result = await this.repository.save(item);
        summary.results.push(result);

        if (result.status === "created") summary.created += 1;
        if (result.status === "updated") summary.updated += 1;
        if (result.status === "skipped") summary.skipped += 1;

        if (result.status !== "skipped") {
          summary.itemsToAnalyze.push(structuredClone(result.item));
        }
      } catch (error) {
        summary.errors.push({
          rawItemId: item.id,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return summary;
  }
}
