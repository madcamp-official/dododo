import type {
  ContextItem,
  ContextRepository,
  Fact,
  RawItem,
} from "../../shared/src/index.ts";

export * from "./in-memory-raw-item-repository.ts";
export * from "./raw-item-repository.ts";

export class InMemoryContextRepository implements ContextRepository {
  private readonly rawItems = new Map<string, RawItem>();
  private readonly facts = new Map<string, Fact>();
  private readonly contextItems = new Map<string, ContextItem>();

  async saveRawItems(items: RawItem[]): Promise<void> {
    for (const item of items) this.rawItems.set(item.id, structuredClone(item));
  }

  async saveFacts(facts: Fact[]): Promise<void> {
    for (const fact of facts) this.facts.set(fact.id, structuredClone(fact));
  }

  async saveContextItems(items: ContextItem[]): Promise<void> {
    for (const item of items) this.contextItems.set(item.id, structuredClone(item));
  }

  async listContextItems(kind?: ContextItem["kind"]): Promise<ContextItem[]> {
    return [...this.contextItems.values()]
      .filter((item) => kind === undefined || item.kind === kind)
      .map((item) => structuredClone(item));
  }

  async findContextItem(id: string): Promise<ContextItem | undefined> {
    const item = this.contextItems.get(id);
    return item ? structuredClone(item) : undefined;
  }
}

// TODO(Data & Storage): 같은 ContextRepository 계약을 구현하는 SQLiteRepository를 추가한다.
