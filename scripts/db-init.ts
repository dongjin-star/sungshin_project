/**
 * SQLite 스키마 초기화 · 검증 (PRD §6.1)
 *
 * 실행: npm run db:init
 *
 * lib/db/index.ts 는 "server-only" 라 스크립트에서 import 할 수 없으므로
 * 스키마 파일만 읽어 직접 적용한다. 진실 소스는 schema.sql 하나뿐이다.
 */

import Database from "better-sqlite3";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

try {
  process.loadEnvFile(".env.local");
} catch {
  // 기본값을 쓴다
}

const path = resolve(process.env.DATABASE_PATH ?? "./data/posture.db");
mkdirSync(dirname(path), { recursive: true });

const db = new Database(path);
db.exec(readFileSync("src/lib/db/schema.sql", "utf8"));

const tables = db
  .prepare<[], { name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  )
  .all();

console.log(`SQLite 초기화 완료 — ${path}\n`);
for (const t of tables) {
  const { c } = db.prepare<[], { c: number }>(`SELECT COUNT(*) AS c FROM "${t.name}"`).get()!;
  console.log(`  ${t.name.padEnd(20)} ${c.toLocaleString()}행`);
}
console.log();

db.close();
