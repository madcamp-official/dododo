import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { GatewayStore, hashSecret, type IssuedActivationCode } from "./store.ts";

const DEFAULT_DATABASE_PATH = "/var/lib/dododo/gateway.db";
const DEFAULT_EXPIRY_DAYS = 7;

function main(args: string[]): void {
  const databasePath = process.env.GATEWAY_DB_PATH?.trim() || DEFAULT_DATABASE_PATH;
  if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true });
  const store = new GatewayStore(databasePath);
  try {
    const command = args[0];
    if (command === "issue") {
      issue(store, args.slice(1));
      return;
    }
    if (command === "list") {
      list(store);
      return;
    }
    if (command === "revoke") {
      revoke(store, args.slice(1));
      return;
    }
    throw new Error(usage());
  } finally {
    store.close();
  }
}

function issue(store: GatewayStore, args: string[]): void {
  const label = requiredOption(args, "--label", 100);
  const expiryDays = positiveIntegerOption(args, "--expires-days", DEFAULT_EXPIRY_DAYS);
  rejectUnknownOptions(args, new Set(["--label", "--expires-days"]));

  const now = new Date();
  const expiresAt = new Date(now.getTime() + expiryDays * 24 * 60 * 60 * 1000);
  const code = `dodo_setup_${randomBytes(18).toString("base64url")}`;
  const id = `ac_${randomUUID().replaceAll("-", "")}`;
  const record = store.registerActivationCode(
    id,
    hashSecret(code),
    label,
    now.toISOString(),
    expiresAt.toISOString(),
  );

  console.log("설치 코드가 발급·등록되었습니다. 원문은 지금 한 번만 표시됩니다.");
  console.log(`ID: ${record.id}`);
  console.log(`대상: ${record.label}`);
  console.log(`만료: ${record.expiresAt}`);
  console.log(`설치 코드: ${code}`);
}

function list(store: GatewayStore): void {
  const records = store.listIssuedActivationCodes();
  if (records.length === 0) {
    console.log("발급된 설치 코드가 없습니다.");
    return;
  }
  const now = new Date();
  for (const record of records) {
    console.log([
      record.id,
      activationCodeStatus(record, now),
      record.label,
      `생성 ${record.createdAt}`,
      `만료 ${record.expiresAt ?? "없음"}`,
    ].join(" · "));
  }
}

function revoke(store: GatewayStore, args: string[]): void {
  const id = requiredOption(args, "--id", 100);
  rejectUnknownOptions(args, new Set(["--id"]));
  if (!store.revokeActivationCode(id, new Date().toISOString())) {
    throw new Error("사용 가능 상태인 설치 코드 ID를 찾지 못했습니다");
  }
  console.log(`설치 코드를 취소했습니다: ${id}`);
}

function requiredOption(args: string[], name: string, maxLength: number): string {
  const index = args.indexOf(name);
  const value = index === -1 ? undefined : args[index + 1];
  const normalized = value?.trim();
  if (normalized === undefined || normalized === "" || normalized.length > maxLength || /[\r\n\t]/.test(normalized)) {
    throw new Error(`${name} 값이 필요합니다\n${usage()}`);
  }
  return normalized;
}

function positiveIntegerOption(args: string[], name: string, fallback: number): number {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  const value = Number(args[index + 1]);
  if (!Number.isSafeInteger(value) || value <= 0 || value > 365) {
    throw new Error(`${name}는 1~365 사이의 정수여야 합니다`);
  }
  return value;
}

function rejectUnknownOptions(args: string[], allowed: Set<string>): void {
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    if (option === undefined || !allowed.has(option) || args[index + 1] === undefined) {
      throw new Error(usage());
    }
  }
}

function activationCodeStatus(record: IssuedActivationCode, now: Date): string {
  if (record.usedAt !== undefined) return "사용됨";
  if (record.revokedAt !== undefined) return "취소됨";
  if (record.expiresAt !== undefined && new Date(record.expiresAt) <= now) return "만료됨";
  return "사용 가능";
}

function usage(): string {
  return [
    "사용법:",
    "  npm run gateway:activation-code -- issue --label <사용자> [--expires-days 7]",
    "  npm run gateway:activation-code -- list",
    "  npm run gateway:activation-code -- revoke --id <코드 ID>",
  ].join("\n");
}

try {
  main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
