import type { Collector, RawItem, SourceType } from "../../shared/src/index.ts";

export interface SourceCollectionError {
  sourceUri?: string;
  message: string;
}

export interface SourceCollectionResult {
  sourceId: string;
  sourceType: SourceType;
  collected: number;
  items: RawItem[];
  errors: SourceCollectionError[];
}

interface CollectorWithDiagnostics extends Collector {
  listErrors(): Array<{ sourceUri?: string; message: string }>;
}

/**
 * Collects every source independently so that a loader or parser failure in one
 * source does not discard RawItems produced by the other sources.
 */
export async function collectSources(
  collectors: readonly Collector[],
): Promise<SourceCollectionResult[]> {
  return Promise.all(collectors.map(async (collector) => {
    try {
      const items = await collector.sync();
      return {
        sourceId: collector.sourceId,
        sourceType: collector.sourceType,
        collected: items.length,
        items,
        errors: readDiagnostics(collector),
      };
    } catch (error) {
      return {
        sourceId: collector.sourceId,
        sourceType: collector.sourceType,
        collected: 0,
        items: [],
        errors: [{ message: error instanceof Error ? error.message : String(error) }],
      };
    }
  }));
}

function readDiagnostics(collector: Collector): SourceCollectionError[] {
  if (!hasDiagnostics(collector)) return [];
  return collector.listErrors().map((error) => ({
    ...(error.sourceUri === undefined ? {} : { sourceUri: error.sourceUri }),
    message: error.message,
  }));
}

function hasDiagnostics(collector: Collector): collector is CollectorWithDiagnostics {
  return "listErrors" in collector
    && typeof (collector as Partial<CollectorWithDiagnostics>).listErrors === "function";
}
