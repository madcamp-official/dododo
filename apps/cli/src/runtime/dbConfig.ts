import { isAbsolute, resolve } from "node:path";

// .env.example가 이미 DODODO_DB_PATH=./data/context.db를 예시로 문서화해 두었다.
// 미설정이면 undefined를 반환해 호출부가 기존 InMemory 저장소로 폴백하게 한다 —
// DODODO_LLM_BASE_URL과 같은 패턴: 설정 파일 하나로 데모(InMemory)/영속(SQLite)을
// 전환하고, .env 없이도 지금처럼 회귀 없이 동작해야 한다.
export function resolveDbPath(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): string | undefined {
  const raw = env.DODODO_DB_PATH?.trim();
  if (raw === undefined || raw === "") return undefined;
  return isAbsolute(raw) ? raw : resolve(cwd, raw);
}
