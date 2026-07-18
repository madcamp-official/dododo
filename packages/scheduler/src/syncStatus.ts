import type { SyncResult } from "../../shared/src/index.ts";

export interface SourceSyncStatus {
  sourceId: string;
  lastSyncedAt: string;
  lastResult: SyncResult;
}

export class SyncStatusStore {
  private readonly statusBySourceId = new Map<string, SourceSyncStatus>();

  record(result: SyncResult, now: Date = new Date()): void {
    this.statusBySourceId.set(result.sourceId, {
      sourceId: result.sourceId,
      lastSyncedAt: now.toISOString(),
      lastResult: structuredClone(result),
    });
  }

  get(sourceId: string): SourceSyncStatus | undefined {
    const status = this.statusBySourceId.get(sourceId);
    return status ? structuredClone(status) : undefined;
  }

  list(): SourceSyncStatus[] {
    return [...this.statusBySourceId.values()].map((status) => structuredClone(status));
  }
}
