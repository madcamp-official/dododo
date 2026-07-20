import type { DatabaseSync } from "node:sqlite";

import type {
  ContextChangeEvent,
  ContextItem,
  ContextKind,
  ContextRepository,
  ContextStatus,
  Evidence,
  Fact,
  FactKind,
  RawItem,
  RawItemAnalysisResult,
  Recommendation,
  SourceType,
  StoredFact,
} from "../../../shared/src/index.ts";
import { hasSameActiveFacts } from "../analysis-idempotency.ts";
import { SQLiteRawItemRepository } from "./sqlite-raw-item-repository.ts";

export class SQLiteContextRepository implements ContextRepository {
  private readonly database: DatabaseSync;
  private readonly rawItems: SQLiteRawItemRepository;

  constructor(database: DatabaseSync) {
    this.database = database;
    this.rawItems = new SQLiteRawItemRepository(database);
  }

  async saveRawItems(items: RawItem[]): Promise<void> {
    for (const item of items) await this.rawItems.save(item);
  }

  async saveFacts(facts: Fact[]): Promise<void> {
    const find = this.database.prepare("SELECT status FROM facts WHERE id = ?");
    const upsert = this.database.prepare(`
      INSERT INTO facts (
        id, raw_item_id, kind, subject, value, event_time, confidence,
        evidence_text, status, superseded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', NULL)
      ON CONFLICT(id) DO UPDATE SET
        raw_item_id = excluded.raw_item_id,
        kind = excluded.kind,
        subject = excluded.subject,
        value = excluded.value,
        event_time = excluded.event_time,
        confidence = excluded.confidence,
        evidence_text = excluded.evidence_text,
        status = 'active',
        superseded_at = NULL
    `);

    for (const fact of facts) {
      const existing = find.get(fact.id) as { status: string } | undefined;
      if (existing?.status === "inactive") {
        throw new Error(`비활성 Fact ID는 새 분석에서 재사용할 수 없습니다: ${fact.id}`);
      }
      upsert.run(
        fact.id,
        fact.rawItemId,
        fact.kind,
        fact.subject,
        fact.value,
        fact.eventTime ?? null,
        fact.confidence,
        fact.evidenceText,
      );
    }
  }

  async saveContextItems(items: ContextItem[]): Promise<void> {
    const statement = this.database.prepare(`
      INSERT INTO context_items (
        id, kind, title, status, deadline, start_at, end_at,
        requirements_json, tags_json, priority, confidence, evidence_ids_json,
        metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        kind = excluded.kind,
        title = excluded.title,
        status = excluded.status,
        deadline = excluded.deadline,
        start_at = excluded.start_at,
        end_at = excluded.end_at,
        requirements_json = excluded.requirements_json,
        tags_json = excluded.tags_json,
        priority = excluded.priority,
        confidence = excluded.confidence,
        evidence_ids_json = excluded.evidence_ids_json,
        metadata_json = excluded.metadata_json,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
    `);
    for (const item of items) {
      statement.run(
        item.id, item.kind, item.title, item.status, item.deadline ?? null,
        item.startAt ?? null, item.endAt ?? null, JSON.stringify(item.requirements),
        JSON.stringify(item.tags), item.priority, item.confidence,
        JSON.stringify(item.evidenceIds), JSON.stringify(item.metadata),
        item.createdAt, item.updatedAt,
      );
    }
  }

  async listContextItems(kind?: ContextItem["kind"]): Promise<ContextItem[]> {
    const rows = kind === undefined
      ? this.database.prepare(`${SELECT_CONTEXT_ITEM} ORDER BY id`).all()
      : this.database.prepare(`${SELECT_CONTEXT_ITEM} WHERE kind = ? ORDER BY id`).all(kind);
    return rows.map(rowToContextItem);
  }

  async findContextItem(id: string): Promise<ContextItem | undefined> {
    const row = this.database.prepare(`${SELECT_CONTEXT_ITEM} WHERE id = ?`).get(id);
    return row === undefined ? undefined : rowToContextItem(row);
  }

  async listFactsByRawItemId(
    rawItemId: string,
    options: { includeInactive?: boolean } = {},
  ): Promise<StoredFact[]> {
    const condition = options.includeInactive === true ? "" : " AND status = 'active'";
    const rows = this.database.prepare(
      `${SELECT_FACT} WHERE raw_item_id = ?${condition} ORDER BY id`,
    ).all(rawItemId);
    return rows.map(rowToStoredFact);
  }

  async deactivateFactsByRawItemId(rawItemId: string, deactivatedAt: string): Promise<void> {
    this.database.prepare(`
      UPDATE facts SET status = 'inactive', superseded_at = ?
      WHERE raw_item_id = ? AND status = 'active'
    `).run(deactivatedAt, rawItemId);
  }

  async saveEvidence(items: Evidence[]): Promise<void> {
    const statement = this.database.prepare(`
      INSERT INTO evidence (
        id, raw_item_id, source_type, location, quote, observed_at, authority
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        raw_item_id = excluded.raw_item_id,
        source_type = excluded.source_type,
        location = excluded.location,
        quote = excluded.quote,
        observed_at = excluded.observed_at,
        authority = excluded.authority
    `);
    for (const item of items) {
      statement.run(
        item.id, item.rawItemId, item.sourceType, item.location,
        item.quote, item.observedAt, item.authority,
      );
    }
  }

  async listEvidence(ids: string[]): Promise<Evidence[]> {
    if (ids.length === 0) return [];
    const find = this.database.prepare(`${SELECT_EVIDENCE} WHERE id = ?`);
    return ids
      .map((id) => find.get(id))
      .filter((row): row is NonNullable<typeof row> => row !== undefined)
      .map(rowToEvidence);
  }

  async listEvidenceByContextItemId(contextItemId: string): Promise<Evidence[]> {
    const item = await this.findContextItem(contextItemId);
    return item === undefined ? [] : this.listEvidence(item.evidenceIds);
  }

  async saveContextHistory(events: ContextChangeEvent[]): Promise<void> {
    const find = this.database.prepare(`${SELECT_HISTORY} WHERE id = ?`);
    const insert = this.database.prepare(`
      INSERT INTO context_change_events (
        id, context_item_id, change_type, field, previous_value_json,
        new_value_json, evidence_id, changed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const event of events) {
      const existingRow = find.get(event.id);
      if (existingRow !== undefined) {
        if (!isStructurallyEqual(rowToHistory(existingRow), event)) {
          throw new Error(`Context 변경 이력은 수정할 수 없습니다: ${event.id}`);
        }
        continue;
      }
      insert.run(
        event.id, event.contextItemId, event.changeType, event.field ?? null,
        stringifyOptional(event.previousValue), stringifyOptional(event.newValue),
        event.evidenceId ?? null, event.changedAt,
      );
    }
  }

  async listContextHistory(contextItemId: string): Promise<ContextChangeEvent[]> {
    return this.database.prepare(
      `${SELECT_HISTORY} WHERE context_item_id = ? ORDER BY changed_at, id`,
    ).all(contextItemId).map(rowToHistory);
  }

  async saveRecommendations(items: Recommendation[]): Promise<void> {
    const statement = this.database.prepare(`
      INSERT INTO recommendations (
        id, context_item_id, action, reason, score, evidence_ids_json,
        created_at, suppressed_until
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        context_item_id = excluded.context_item_id,
        action = excluded.action,
        reason = excluded.reason,
        score = excluded.score,
        evidence_ids_json = excluded.evidence_ids_json,
        created_at = excluded.created_at,
        suppressed_until = excluded.suppressed_until
    `);
    for (const item of items) {
      statement.run(
        item.id, item.contextItemId, item.action, item.reason, item.score,
        JSON.stringify(item.evidenceIds), item.createdAt, item.suppressedUntil ?? null,
      );
    }
  }

  async listRecommendations(contextItemId?: string): Promise<Recommendation[]> {
    const rows = contextItemId === undefined
      ? this.database.prepare(`${SELECT_RECOMMENDATION} ORDER BY created_at, id`).all()
      : this.database.prepare(
        `${SELECT_RECOMMENDATION} WHERE context_item_id = ? ORDER BY created_at, id`,
      ).all(contextItemId);
    return rows.map(rowToRecommendation);
  }

  async saveRawItemAnalysis(result: RawItemAnalysisResult): Promise<void> {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const savedRawItem = (await this.rawItems.save(result.rawItem)).item;
      const facts = result.facts.map((fact) => canonicalizeRawItemId(fact, result.rawItem.id, savedRawItem.id));
      const evidence = result.evidence.map((item) => canonicalizeRawItemId(item, result.rawItem.id, savedRawItem.id));
      const activeFacts = await this.listFactsByRawItemId(savedRawItem.id);
      if (!hasSameActiveFacts(activeFacts, facts)) {
        await this.deactivateFactsByRawItemId(savedRawItem.id, result.analyzedAt);
        await this.saveFacts(facts);
      }
      await this.saveContextItems(result.contextItems);
      await this.saveEvidence(evidence);
      await this.saveContextHistory(result.history);
      await this.saveRecommendations(result.recommendations ?? []);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

const SELECT_FACT = `
  SELECT id, raw_item_id, kind, subject, value, event_time, confidence,
         evidence_text, status, superseded_at FROM facts
`;

const SELECT_CONTEXT_ITEM = `
  SELECT id, kind, title, status, deadline, start_at, end_at,
         requirements_json, tags_json, priority, confidence, evidence_ids_json,
         metadata_json, created_at, updated_at FROM context_items
`;

const SELECT_EVIDENCE = `
  SELECT id, raw_item_id, source_type, location, quote, observed_at, authority FROM evidence
`;

const SELECT_HISTORY = `
  SELECT id, context_item_id, change_type, field, previous_value_json,
         new_value_json, evidence_id, changed_at FROM context_change_events
`;

const SELECT_RECOMMENDATION = `
  SELECT id, context_item_id, action, reason, score, evidence_ids_json,
         created_at, suppressed_until FROM recommendations
`;

type SqlRow = Record<string, unknown>;

function rowToStoredFact(row: unknown): StoredFact {
  const value = row as SqlRow;
  const eventTime = nullableString(value.event_time);
  const supersededAt = nullableString(value.superseded_at);
  return {
    id: value.id as string,
    rawItemId: value.raw_item_id as string,
    kind: value.kind as FactKind,
    subject: value.subject as string,
    value: value.value as string,
    ...(eventTime === undefined ? {} : { eventTime }),
    confidence: value.confidence as number,
    evidenceText: value.evidence_text as string,
    status: value.status as StoredFact["status"],
    ...(supersededAt === undefined ? {} : { supersededAt }),
  };
}

function rowToContextItem(row: unknown): ContextItem {
  const value = row as SqlRow;
  const deadline = nullableString(value.deadline);
  const startAt = nullableString(value.start_at);
  const endAt = nullableString(value.end_at);
  return {
    id: value.id as string,
    kind: value.kind as ContextKind,
    title: value.title as string,
    status: value.status as ContextStatus,
    ...(deadline === undefined ? {} : { deadline }),
    ...(startAt === undefined ? {} : { startAt }),
    ...(endAt === undefined ? {} : { endAt }),
    requirements: parseStringArray(value.requirements_json, "requirements_json"),
    tags: parseStringArray(value.tags_json, "tags_json"),
    priority: value.priority as number,
    confidence: value.confidence as number,
    evidenceIds: parseStringArray(value.evidence_ids_json, "evidence_ids_json"),
    metadata: parseObject(value.metadata_json, "metadata_json"),
    createdAt: value.created_at as string,
    updatedAt: value.updated_at as string,
  };
}

function rowToEvidence(row: unknown): Evidence {
  const value = row as SqlRow;
  return {
    id: value.id as string,
    rawItemId: value.raw_item_id as string,
    sourceType: value.source_type as SourceType,
    location: value.location as string,
    quote: value.quote as string,
    observedAt: value.observed_at as string,
    authority: value.authority as Evidence["authority"],
  };
}

function rowToHistory(row: unknown): ContextChangeEvent {
  const value = row as SqlRow;
  const field = nullableString(value.field);
  const previousValue = parseOptionalJSON(value.previous_value_json);
  const newValue = parseOptionalJSON(value.new_value_json);
  const evidenceId = nullableString(value.evidence_id);
  return {
    id: value.id as string,
    contextItemId: value.context_item_id as string,
    changeType: value.change_type as ContextChangeEvent["changeType"],
    ...(field === undefined ? {} : { field }),
    ...(previousValue === undefined ? {} : { previousValue }),
    ...(newValue === undefined ? {} : { newValue }),
    ...(evidenceId === undefined ? {} : { evidenceId }),
    changedAt: value.changed_at as string,
  };
}

function rowToRecommendation(row: unknown): Recommendation {
  const value = row as SqlRow;
  const suppressedUntil = nullableString(value.suppressed_until);
  return {
    id: value.id as string,
    contextItemId: value.context_item_id as string,
    action: value.action as string,
    reason: value.reason as string,
    score: value.score as number,
    evidenceIds: parseStringArray(value.evidence_ids_json, "evidence_ids_json"),
    createdAt: value.created_at as string,
    ...(suppressedUntil === undefined ? {} : { suppressedUntil }),
  };
}

function nullableString(value: unknown): string | undefined {
  return value === null ? undefined : value as string;
}

function parseStringArray(value: unknown, field: string): string[] {
  const parsed = JSON.parse(value as string) as unknown;
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
    throw new Error(`SQLite ContextItem의 ${field}이 문자열 배열이 아닙니다`);
  }
  return parsed;
}

function parseObject(value: unknown, field: string): Record<string, unknown> {
  const parsed = JSON.parse(value as string) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`SQLite ContextItem의 ${field}이 객체가 아닙니다`);
  }
  return parsed as Record<string, unknown>;
}

function stringifyOptional(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

function parseOptionalJSON(value: unknown): unknown {
  return value === null ? undefined : JSON.parse(value as string);
}

function canonicalizeRawItemId<T extends { rawItemId: string }>(
  value: T,
  inputId: string,
  storedId: string,
): T {
  return value.rawItemId === inputId ? { ...value, rawItemId: storedId } : value;
}

function isStructurallyEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
