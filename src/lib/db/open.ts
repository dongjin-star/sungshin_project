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
 * 기본 DB 파일 경로. `DATABASE_PATH` 로 명시하지 않았다면 로컬 개발 기준값이다.
 *
 * ⚠️ 이 경로가 실제로 열리는 경로라는 보장은 없다 — `openDb()` 가 여기 쓰기에
 *    실패하면 `/tmp` 로 자동 전환한다. 아래 주석 참고.
 */
export function dbPath(): string {
  return resolve(process.env.DATABASE_PATH ?? "./data/posture.db");
}

/**
 * 서버리스 배포에서 유일하게 쓸 수 있는 경로. Vercel·AWS Lambda 등
 * 대부분의 서버리스 Node 런타임이 이 경로만 쓰기를 허용한다.
 */
const FALLBACK_PATH = "/tmp/posture.db";

function createAt(path: string): Database.Database {
  mkdirSync(dirname(path), { recursive: true });

  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(readFileSync(join(process.cwd(), "src/lib/db/schema.sql"), "utf8"));
  migrate(db);
  return db;
}

/**
 * DB 핸들. 연결에 실패하면 null 을 돌려주고 호출부가 폴백하게 한다.
 * 여기서 던지면 캐시 문제가 곧 서비스 장애가 된다 (§12.4).
 *
 * ── /tmp 폴백을 환경변수가 아니라 실패 자체로 판단한다 (§10.3-a 정정) ──
 *
 * 처음엔 `process.env.VERCEL` 로 "여기가 Vercel인가"를 미리 짐작해 경로를
 * 갈랐다. 그런데 실제 배포에서 이 값이 런타임에 잡히지 않아(Vercel 프로젝트
 * 설정에 따라 System Environment Variables 노출 여부가 달랐다), 매 요청이
 * 기본 경로(`./data/posture.db` → 배포 번들 안의 읽기 전용 경로)에 쓰려다
 * `ENOENT`로 실패하고 캐시 없는 폴백으로 빠졌다 — 실제 장애 로그로 확인했다.
 *
 * 환경변수로 미리 맞히려 하지 않는다. **기본 경로에 실제로 못 쓴다는 사실
 * 자체**를 신호로 삼아 그 자리에서 `/tmp` 로 넘어간다. 어떤 플랫폼이든,
 * 어떤 환경변수 노출 정책이든 이 판단은 항상 맞는다 — 못 쓰면 못 쓰는 것이다.
 */
export function openDb(): Database.Database | null {
  if (instance !== null) return instance;
  if (initFailed) return null;

  const primaryPath = dbPath();
  let db: Database.Database;
  let usedFallback = false;

  try {
    db = createAt(primaryPath);
  } catch (primaryErr) {
    const alreadyTriedFallback = resolve(FALLBACK_PATH) === primaryPath;
    const explicitPath = process.env.DATABASE_PATH !== undefined;

    if (explicitPath || alreadyTriedFallback) {
      // 사용자가 명시한 경로거나, 이미 /tmp 를 시도한 것이다.
      // 조용히 다른 곳으로 새지 않는다 — 더 시도할 곳이 없다.
      initFailed = true;
      console.error(
        "[db] SQLite 초기화 실패. 캐시 없이 토스 API 직접 호출로 폴백한다 (§12.4).",
        primaryErr instanceof Error ? primaryErr.message : primaryErr,
      );
      return null;
    }

    try {
      db = createAt(FALLBACK_PATH);
      usedFallback = true;
      console.warn(
        `[db] 기본 경로(${primaryPath})에 쓸 수 없어 ${FALLBACK_PATH} 로 전환했다 — ` +
          "서버리스 읽기 전용 배포 환경으로 보인다. " +
          `원인: ${primaryErr instanceof Error ? primaryErr.message : primaryErr}`,
      );
    } catch (fallbackErr) {
      initFailed = true;
      console.error(
        "[db] SQLite 초기화 실패 (기본 경로·/tmp 모두 실패). " +
          "캐시 없이 토스 API 직접 호출로 폴백한다 (§12.4).",
        fallbackErr instanceof Error ? fallbackErr.message : fallbackErr,
      );
      return null;
    }
  }

  // /tmp 로 넘어왔다는 것 자체가 "콜드스타트마다 비워질 가능성이 큰 환경"
  // 이라는 신호다. 스냅샷이 없으면 로컬 개발과 달리 눈에 띄게 알린다.
  restoreMasterSeedIfEmpty(db, usedFallback);

  instance = db;
  return db;
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
function restoreMasterSeedIfEmpty(db: Database.Database, loud: boolean): void {
  try {
    if (countStocks(db) > 0) return;

    const seedPath = join(process.cwd(), DB_SEED_PATH);
    if (!existsSync(seedPath)) {
      // 로컬 개발은 `npm run sync:master` 가 채우기 전까지 원래 비어 있다.
      // /tmp 로 폴백한 배포 환경인데 없다면 번들링이 빠진 것이므로 눈에
      // 띄게 알린다 — `loud` 는 "이 경로가 /tmp 로 넘어왔는가"로 판단한다
      // (환경변수가 아니라 실제로 어느 경로가 열렸는지가 근거다).
      if (loud) {
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
