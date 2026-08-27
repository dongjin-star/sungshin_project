/**
 * SQLite 커넥션 — 구현부 (PRD §6.1, D-03 결정: SQLite)
 *
 * `index.ts` 가 이 모듈을 `server-only` 로 감싸 앱에 노출한다.
 * 배치 스크립트는 server-only 를 import 할 수 없으므로 여기를 직접 쓴다.
 */

import Database from "better-sqlite3";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

let instance: Database.Database | null = null;
let initFailed = false;

export function dbPath(): string {
  return resolve(process.env.DATABASE_PATH ?? "./data/posture.db");
}

/**
 * DB 핸들. 연결에 실패하면 null 을 돌려주고 호출부가 폴백하게 한다.
 * 여기서 던지면 캐시 문제가 곧 서비스 장애가 된다 (§12.4).
 */
export function openDb(): Database.Database | null {
  if (instance !== null) return instance;
  if (initFailed) return null;

  try {
    const path = dbPath();
    mkdirSync(dirname(path), { recursive: true });

    const db = new Database(path);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.exec(readFileSync(join(process.cwd(), "src/lib/db/schema.sql"), "utf8"));
    migrate(db);

    instance = db;
    return db;
  } catch (err) {
    // 한 번 실패하면 매 요청마다 재시도하지 않는다 — 로그만 시끄러워진다.
    initFailed = true;
    console.error(
      "[db] SQLite 초기화 실패. 캐시 없이 토스 API 직접 호출로 폴백한다 (§12.4).",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * 컬럼 추가 마이그레이션.
 *
 * `CREATE TABLE IF NOT EXISTS` 는 이미 있는 테이블에 새 컬럼을 붙여주지
 * 않는다. schema.sql 에 컬럼을 더해도 기존 DB 는 그대로라, 배포 후
 * "no such column" 으로 죽는다. SQLite 에는 `ADD COLUMN IF NOT EXISTS`
 * 가 없으므로 `table_info` 를 보고 없는 것만 붙인다.
 *
 * 테이블을 새로 만드는 경우엔 schema.sql 이 이미 컬럼을 포함하므로
 * 여기서 할 일이 없다 — 둘 다 같은 결과에 도달한다.
 */
function migrate(db: Database.Database): void {
  const ADDITIONS: { table: string; column: string; ddl: string }[] = [
    // 검색 랭킹용 (§5.2). 2026-08-27 추가.
    { table: "stock", column: "security_type", ddl: "TEXT" },
    { table: "stock", column: "is_common_share", ddl: "INTEGER" },
  ];

  for (const { table, column, ddl } of ADDITIONS) {
    const columns = db
      .prepare<[], { name: string }>(`PRAGMA table_info("${table}")`)
      .all()
      .map((c) => c.name);

    if (columns.length === 0) continue; // 테이블 자체가 없다
    if (columns.includes(column)) continue;

    db.exec(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${ddl}`);
    console.log(`[db] 마이그레이션: ${table}.${column} 추가`);
  }
}

/** 스크립트·테스트에서 명시적으로 닫을 때 */
export function closeDbInstance(): void {
  instance?.close();
  instance = null;
  initFailed = false;
}
