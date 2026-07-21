import type { DatabaseSync } from "node:sqlite";

import type { ProfileRepository, UserProfile } from "../../../shared/src/index.ts";

// 프로필은 단일 사용자 기기 기준 한 행만 존재한다(schema.ts의 id=1 CHECK 제약과 짝).
// setup 명령이 이 저장소에 저장해야 프로세스를 재시작해도 관심사·활동유형·Quiet Hours가
// 유지되고, today/inbox/watch의 관련도 계산(packages/context-engine/src/relevance)이
// 빈 프로필로 폴백하지 않는다.
const ROW_ID = 1;

export class SQLiteProfileRepository implements ProfileRepository {
  private readonly database: DatabaseSync;

  constructor(database: DatabaseSync) {
    this.database = database;
  }

  async get(): Promise<UserProfile | undefined> {
    const row = this.database.prepare(`
      SELECT school, major, year, interests_json, activity_types_json,
             preferred_locations_json, quiet_hours_json, explicit_constraints_json
      FROM user_profile WHERE id = ?
    `).get(ROW_ID);
    return row === undefined ? undefined : rowToProfile(row);
  }

  async save(profile: UserProfile): Promise<void> {
    this.database.prepare(`
      INSERT INTO user_profile (
        id, school, major, year, interests_json, activity_types_json,
        preferred_locations_json, quiet_hours_json, explicit_constraints_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        school = excluded.school,
        major = excluded.major,
        year = excluded.year,
        interests_json = excluded.interests_json,
        activity_types_json = excluded.activity_types_json,
        preferred_locations_json = excluded.preferred_locations_json,
        quiet_hours_json = excluded.quiet_hours_json,
        explicit_constraints_json = excluded.explicit_constraints_json
    `).run(
      ROW_ID,
      profile.school,
      profile.major,
      profile.year,
      JSON.stringify(profile.interests),
      JSON.stringify(profile.activityTypes),
      JSON.stringify(profile.preferredLocations),
      profile.quietHours === undefined ? null : JSON.stringify(profile.quietHours),
      JSON.stringify(profile.explicitConstraints),
    );
  }
}

type SqlRow = Record<string, unknown>;

function rowToProfile(row: unknown): UserProfile {
  const value = row as SqlRow;
  const quietHours = parseOptionalObject(value.quiet_hours_json, "quiet_hours_json");
  return {
    school: value.school as string,
    major: value.major as string,
    year: value.year as string,
    interests: parseStringArray(value.interests_json, "interests_json"),
    activityTypes: parseStringArray(value.activity_types_json, "activity_types_json"),
    preferredLocations: parseStringArray(value.preferred_locations_json, "preferred_locations_json"),
    ...(quietHours === undefined ? {} : { quietHours: quietHours as UserProfile["quietHours"] }),
    explicitConstraints: parseStringArray(value.explicit_constraints_json, "explicit_constraints_json"),
  };
}

function parseStringArray(value: unknown, field: string): string[] {
  const parsed = JSON.parse(value as string) as unknown;
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
    throw new Error(`SQLite UserProfile의 ${field}이 문자열 배열이 아닙니다`);
  }
  return parsed;
}

function parseOptionalObject(value: unknown, field: string): Record<string, unknown> | undefined {
  if (value === null || value === undefined) return undefined;
  const parsed = JSON.parse(value as string) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`SQLite UserProfile의 ${field}이 객체가 아닙니다`);
  }
  return parsed as Record<string, unknown>;
}
