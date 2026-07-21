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
  const quietHours = parseQuietHours(value.quiet_hours_json);
  return {
    school: value.school as string,
    major: value.major as string,
    year: value.year as string,
    interests: parseStringArray(value.interests_json, "interests_json"),
    activityTypes: parseStringArray(value.activity_types_json, "activity_types_json"),
    preferredLocations: parseStringArray(value.preferred_locations_json, "preferred_locations_json"),
    ...(quietHours === undefined ? {} : { quietHours }),
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

// packages/scheduler(박도현 소유)의 isValidClockTime과 같은 형식(zero-padded HH:mm,
// 00-23:59)을 검사한다. import로 재사용하면 packages/storage가 packages/scheduler에
// 의존하게 되어 두 담당 영역 경계를 새로 만들게 되므로, 이 파일 하나에 필요한 정규식
// 한 줄만 복제해 둔다 — setup.ts가 저장 전에 이미 isValidClockTime으로 검증하므로
// 이 값은 정상적으로는 항상 이 형식이지만, quiet_hours_json은 신뢰할 수 없는 저장소
// 원본 값이라 읽어올 때도 형식을 확인한다(김도연님 리뷰 nit).
const CLOCK_TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

function parseQuietHours(value: unknown): UserProfile["quietHours"] {
  if (value === null || value === undefined) return undefined;
  const parsed = JSON.parse(value as string) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("SQLite UserProfile의 quiet_hours_json이 객체가 아닙니다");
  }
  const { start, end } = parsed as Record<string, unknown>;
  if (typeof start !== "string" || typeof end !== "string" || !CLOCK_TIME.test(start) || !CLOCK_TIME.test(end)) {
    throw new Error("SQLite UserProfile의 quiet_hours_json이 HH:mm 형식의 start/end를 갖고 있지 않습니다");
  }
  return { start, end };
}
