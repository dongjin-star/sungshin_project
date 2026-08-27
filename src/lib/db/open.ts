/**
 * SQLite 커넥션 — 구현부 (PRD §6.1, D-03 결정: SQLite)
 *
 * `index.ts` 가 이 모듈을 `server-only` 로 감싸 앱에 노출한다.
 * 배치 스크립트는 server-only 를 import 할 수 없으므로 여기를 직접 쓴다.
 */

import Database from "better-sqlite3";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { countStocks, upsertStocks, type StockRow } from "./repo";
import { DB_SEED_PATH } from "../service/db-seed";

let instance: Database.Database | null = null;
let initFailed = false;

/**
 * DB 파일 경로.
 *
 * ⚠️ Vercel 서버리스 함수는 배포 번들이 읽기 전용이다. 쓸 수 있는 곳은
 *    `/tmp` 뿐이고, 그마저도 인스턴스가 재활용되면(콜드스타트) 비워진다.
 *    `DATABASE_PATH` 를 명시하지 않았다면 `process.env.VERCEL` 로 이
 *    환경을 감지해 `/tmp` 를 쓴다 — 그러지 않으면 `mkdirSync` 가
 *    EROFS 로 던지고 매 요청이 §12.4 폴백(캐시 없이 직접 호출)으로
 *    빠진다. 콜드스타트로 비워진 마스터는 `openDb()` 가 스냅샷에서
 *    복원한다 (§10.3-a, `restoreMasterSeedIfEmpty` 참고).
 */
export function dbPath(): string {
  if (process.env.DATABASE_PATH) return resolve(process.env.DATABASE_PATH);
  if (process.env.VERCEL) return "/tmp/posture.db";
  return resolve("./data/posture.db");
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
    restoreMasterSeedIfEmpty(db);

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

/**
 * 콜드스타트로 비워진 종목 마스터를 스냅샷에서 복원한다 (§10.3-a).
 *
 * `stock` 이 이미 채워져 있으면(로컬 개발, 또는 같은 인스턴스의 두 번째
 * 요청) 아무것도 하지 않는다 — 매 요청마다 15,262행을 다시 읽어들일
 * 이유가 없다.
 *
 * 실패해도 던지지 않는다. 마스터가 비어 있는 채로 시작하는 것은 이미
 * §12.4 가 감당하는 상황(모든 종목이 "알 수 없음")이고, 여기서 던지면
 * DB 연결 자체가 실패한 것처럼 보여 캔들 캐시까지 같이 잃는다.
 */
function restoreMasterSeedIfEmpty(db: Database.Database): void {
  try {
    if (countStocks(db) > 0) return;

    const seedPath = join(process.cwd(), DB_SEED_PATH);
    if (!existsSync(seedPath)) {
      // 로컬 개발은 `npm run sync:master` 가 채우기 전까지 원래 비어 있다.
      // 배포 환경인데 없다면 그건 번들링이 빠진 것이므로 눈에 띄게 알린다.
      if (process.env.VERCEL) {
        console.error(
          `🔴 [db] 종목 마스터 스냅샷을 찾지 못했다 (${DB_SEED_PATH}). ` +
            "이 배포에서는 모든 종목이 '알 수 없음'으로 보인다. " +
            "next.config.ts 의 outputFileTracingIncludes 설정과 파일 커밋 여부를 확인하라.",
        );
      }
      return;
    }

    const seed = new Database(seedPath, { readonly: true, fileMustExist: true });
    try {
      const rows = seed.prepare<[], StockRow>("SELECT * FROM stock").all();
      upsertStocks(db, rows);
      console.log(`[db] 종목 마스터 ${rows.length.toLocaleString()}건을 스냅샷에서 복원했다.`);
    } finally {
      seed.close();
    }
  } catch (err) {
    console.error(
      "[db] 종목 마스터 스냅샷 복원 실패:",
      err instanceof Error ? err.message : err,
    );
  }
}

/** 스크립트·테스트에서 명시적으로 닫을 때 */
export function closeDbInstance(): void {
  instance?.close();
  instance = null;
  initFailed = false;
}
