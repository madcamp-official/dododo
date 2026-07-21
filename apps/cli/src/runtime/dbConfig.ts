import { isAbsolute, resolve } from "node:path";

const DEFAULT_RELATIVE_PATH = "./.dododo/dododo.db";
const IN_MEMORY_SENTINEL = ":memory:";

// createCliContainer의 databasePath 옵션(#43·#45와 시그니처를 통일하며 추가됨)과
// DODODO_DB_PATH 둘 다 같은 ":memory:" 표기로 InMemory를 명시하게 한다 — 소스가
// 달라도 동작이 갈리지 않는다.
export function normalizeDbPath(path: string, cwd: string = process.cwd()): string | undefined {
  if (path === IN_MEMORY_SENTINEL) return undefined;
  return isAbsolute(path) ? path : resolve(cwd, path);
}

// PR #40 리뷰(김도현): 미설정 시 InMemory 폴백이면 issue #27(빈 저장소에서 대표
// 시나리오 재현)이 .env 없이 실행한 사람에겐 그대로 남는다 — sync 후 프로세스가
// 끝나면 다 사라진다. 그래서 기본값을 영속(SQLite, ./.dododo/dododo.db)으로 바꾸고,
// InMemory는 DODODO_DB_PATH=:memory:로 명시했을 때만 쓰는 옵션으로 남긴다.
export function resolveDbPath(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): string | undefined {
  const raw = env.DODODO_DB_PATH?.trim();
  const path = raw === undefined || raw === "" ? DEFAULT_RELATIVE_PATH : raw;
  return normalizeDbPath(path, cwd);
}
