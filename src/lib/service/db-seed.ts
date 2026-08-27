/**
 * 종목 마스터 스냅샷 (PRD §10.3-a — Vercel 서버리스 대응)
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────
 *
 * Vercel 서버리스 함수는 배포 번들 바깥에 쓸 수 있는 곳이 `/tmp` 뿐이고,
 * 그마저도 인스턴스가 재활용되면(콜드스타트) 통째로 비워진다. `data/`
 * 아래 SQLite 파일에 의존하던 지금까지의 방식은 Vercel 위에서는 매
 * 콜드스타트마다 빈 DB로 시작한다는 뜻이다.
 *
 * 캔들 캐시(`price_candle`)와 토큰(`toss_token`)은 원래도 "없으면 다시
 * 받는다"로 설계돼 있어 콜드스타트를 견딘다 — 문제는 **종목 마스터
 * (`stock`)** 다. 이게 비어 있으면 `getStock()` 이 항상 null 을 돌려주고,
 * `/api/quotes`·`/api/stock/{symbol}`·`/api/watchlist` 가 전부 "알 수
 * 없는 종목"으로 실패한다. 마스터는 토스를 실시간으로 다시 불러서
 * 채울 수 있는 값이 아니다 — 배치가 하루 한 번 도는 것이다.
 *
 * 그래서 `stock` 테이블만 별도 SQLite 파일로 떠서(build-db-seed) 저장소에
 * 커밋하고, 콜드스타트 시 그 파일에서 복원한다(`src/lib/db/open.ts`).
 * `price_candle`·`toss_token`·`indicator_snapshot`·`symbol_access` 는
 * 담지 않는다 — 앞의 둘은 자연 치유되고, 뒤의 둘은 없어도 앱이 동작한다.
 *
 * `public/search-index.json` 과 같은 운영 패턴이다: `npm run sync:master`
 * 를 돌리면 이것도 같이 갱신되고, 그 결과를 커밋해서 배포한다.
 */

import Database from "better-sqlite3";
import type { Database as DB } from "better-sqlite3";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";

import type { StockRow } from "../db/repo";

export const DB_SEED_PATH = "assets/stock-master.sqlite3";

/** 런타임 복원부(`open.ts`)가 기대하는 스키마. `db/schema.sql` 의 `stock` 부분과 반드시 일치해야 한다 */
const SEED_SCHEMA = `
  CREATE TABLE stock (
    symbol          TEXT PRIMARY KEY,
    name_ko         TEXT,
    name_en         TEXT,
    initials        TEXT,
    market          TEXT NOT NULL,
    exchange        TEXT,
    currency        TEXT NOT NULL,
    listing_status  TEXT NOT NULL,
    shares_out      INTEGER,
    security_type   TEXT,
    is_common_share INTEGER,
    synced_at       TEXT NOT NULL
  );
`;

export function writeDbSeed(sourceDb: DB): { count: number } {
  const rows = sourceDb.prepare<[], StockRow>("SELECT * FROM stock").all();

  mkdirSync(dirname(DB_SEED_PATH), { recursive: true });
  // 증분이 아니라 항상 전체를 새로 굽는다 — 이전 파일이 있으면 지운다
  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    if (existsSync(DB_SEED_PATH + suffix)) rmSync(DB_SEED_PATH + suffix);
  }

  const seed = new Database(DB_SEED_PATH);
  try {
    // WAL 은 -wal/-shm 부산물 파일을 남긴다. 커밋 대상은 파일 하나여야
    // 하므로 기본 롤백 저널을 쓴다 — 어차피 쓰기는 이 빌드 시점 한 번뿐이다.
    seed.pragma("journal_mode = DELETE");
    seed.exec(SEED_SCHEMA);

    const insert = seed.prepare(`
      INSERT INTO stock (
        symbol, name_ko, name_en, initials, market,
        exchange, currency, listing_status, shares_out,
        security_type, is_common_share, synced_at
      ) VALUES (
        @symbol, @name_ko, @name_en, @initials, @market,
        @exchange, @currency, @listing_status, @shares_out,
        @security_type, @is_common_share, @synced_at
      )
    `);
    const insertAll = seed.transaction((items: readonly StockRow[]) => {
      for (const row of items) insert.run(row);
    });
    insertAll(rows);

    // 파일 하나로 남긴다 (WAL 잔여물 없음)을 확인 겸 명시적으로 체크포인트
    seed.pragma("wal_checkpoint(TRUNCATE)");
  } finally {
    seed.close();
  }

  return { count: rows.length };
}
