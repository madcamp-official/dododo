import type { RawItem } from "../../shared/src/index.ts";
import type {
  RawItemRepository,
  RawItemSaveResult,
} from "./raw-item-repository.ts";

export class InMemoryRawItemRepository implements RawItemRepository {
  private readonly itemsById = new Map<string, RawItem>();
  private readonly idByExternalKey = new Map<string, string>();
  private readonly idByUriKey = new Map<string, string>();

  async save(item: RawItem): Promise<RawItemSaveResult> {
    const existing = this.findExisting(item);

    if (existing === undefined) {
      if (this.itemsById.has(item.id)) {
        throw new Error(`이미 다른 RawItem이 사용 중인 id입니다: ${item.id}`);
      }

      this.store(item);
      return { item: structuredClone(item), status: "created" };
    }

    if (existing.contentHash === item.contentHash) {
      return { item: structuredClone(existing), status: "skipped" };
    }

    const updatedItem: RawItem = {
      ...structuredClone(item),
      id: existing.id,
    };

    this.removeIndexes(existing);
    this.store(updatedItem);

    return {
      item: structuredClone(updatedItem),
      status: "updated",
      previousHash: existing.contentHash,
    };
  }

  async findById(id: string): Promise<RawItem | undefined> {
    return cloneOptional(this.itemsById.get(id));
  }

  async findByExternalId(
    sourceId: string,
    externalId: string,
  ): Promise<RawItem | undefined> {
    const id = this.idByExternalKey.get(identityKey(sourceId, externalId));
    return id === undefined ? undefined : cloneOptional(this.itemsById.get(id));
  }

  async findByUri(sourceId: string, uri: string): Promise<RawItem | undefined> {
    const id = this.idByUriKey.get(identityKey(sourceId, uri));
    return id === undefined ? undefined : cloneOptional(this.itemsById.get(id));
  }

  private findExisting(item: RawItem): RawItem | undefined {
    if (item.externalId !== undefined) {
      const id = this.idByExternalKey.get(identityKey(item.sourceId, item.externalId));
      return id === undefined ? undefined : this.itemsById.get(id);
    }

    const id = this.idByUriKey.get(identityKey(item.sourceId, item.uri));
    return id === undefined ? undefined : this.itemsById.get(id);
  }

  private store(item: RawItem): void {
    const storedItem = structuredClone(item);
    this.itemsById.set(storedItem.id, storedItem);

    if (storedItem.externalId !== undefined) {
      this.idByExternalKey.set(
        identityKey(storedItem.sourceId, storedItem.externalId),
        storedItem.id,
      );
    } else {
      this.idByUriKey.set(identityKey(storedItem.sourceId, storedItem.uri), storedItem.id);
    }
  }

  private removeIndexes(item: RawItem): void {
    if (item.externalId !== undefined) {
      this.idByExternalKey.delete(identityKey(item.sourceId, item.externalId));
    } else {
      this.idByUriKey.delete(identityKey(item.sourceId, item.uri));
    }
  }
}

function identityKey(sourceId: string, value: string): string {
  return JSON.stringify([sourceId, value]);
}

function cloneOptional(item: RawItem | undefined): RawItem | undefined {
  return item === undefined ? undefined : structuredClone(item);
}
