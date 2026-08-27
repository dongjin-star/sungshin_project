/**
 * 캐시 리포지토리 (PRD §6.1, §10.4)
 *
 * 순수 SQL 계층이다. 토스 호출도 지표 계산도 하지 않는다.
 * `openDb()` 가 null 을 돌려주는 상황(§12.4 폴백)은 호출부가 판단하도록
 * 각 함수가 Database 핸들을 인자로 받는다.
 */

import type { Database } from "better-sqlite3";
import type { Candle, Market } from "../types";

// ── 종목 마스터 ─────────────────────────────────────────────────────

export interface StockRow {
  symbol: string;
  name_ko: string | null;
  name_en: string | null;
  initials: string | null;
  market: Market;
  exchange: string;
  currency: string;
  listing_status: "LISTED" | "DELISTED" | "SUSPENDED";
  shares_out: number | null;
  /** 검색 랭킹용 (§5.2). search-index 빌드의 정렬 기준이다 */
  security_type: string | null;
  is_common_share: number | null;
  synced_at: string;
}

/**
 * 마스터 UPSERT. 배치가 수천 건을 넣으므로 트랜잭션으로 감싼다.
 *
 * better-sqlite3 는 동기 API 라 트랜잭션 안에서 반복 실행하는 것이
 * 가장 빠르다 — 건당 fsync 가 사라진다.
 */
export function upsertStocks(db: Database, rows: readonly StockRow[]): number {
  const stmt = db.prepare(`
    INSERT INTO stock (
      symbol, name_ko, name_en, initials, market,
      exchange, currency, listing_status, shares_out,
      security_type, is_common_share, synced_at
    ) VALUES (
      @symbol, @name_ko, @name_en, @initials, @market,
      @exchange, @currency, @listing_status, @shares_out,
      @security_type, @is_common_share, @synced_at
    )
    ON CONFLICT(symbol) DO UPDATE SET
      name_ko        = excluded.name_ko,
      name_en        = excluded.name_en,
      initials       = excluded.initials,
      market         = excluded.market,
      exchange       = excluded.exchange,
      currency       = excluded.currency,
      listing_status = excluded.listing_status,
      shares_out      = excluded.shares_out,
      security_type   = excluded.security_type,
      is_common_share = excluded.is_common_share,
      synced_at       = excluded.synced_at
  `);

  const run = db.transaction((batch: readonly StockRow[]) => {
    for (const row of batch) stmt.run(row);
    return batch.length;
  });

  return run(rows);
}

export function getStock(db: Database, symbol: string): StockRow | null {
  return (
    db.prepare<[string], StockRow>("SELECT * FROM stock WHERE symbol = ?").get(symbol) ??
    null
  );
}

export function countStocks(db: Database): number {
  return db.prepare<[], { c: number }>("SELECT COUNT(*) AS c FROM stock").get()!.c;
}

/**
 * 이번 동기화에서 빠진 종목을 상장폐지로 표시한다.
 *
 * 행을 지우지 않는 이유: 관심종목에 남아 있을 수 있고, 그때 "상장폐지"
 * 라고 알려주는 것이 조용히 사라지는 것보다 낫다 (PP-03, §12.1).
 */
export function markMissingAsDelisted(db: Database, syncedAt: string): number {
  return db
    .prepare("UPDATE stock SET listing_status = 'DELISTED' WHERE synced_at < ?")
    .run(syncedAt).changes;
}

// ── 일봉 캐시 ───────────────────────────────────────────────────────

/**
 * 캔들 UPSERT.
 *
 * 액면분할이 일어나면 과거 수정주가가 통째로 바뀐다. UPDATE 로 덮어써야
 * 하는 이유이며, 분할 감지 시 심볼 전체를 지우는 것은 §12.2 의 별도 처리다.
 */
export function upsertCandles(
  db: Database,
  symbol: string,
  candles: readonly Candle[],
  fetchedAt: string,
): number {
  const stmt = db.prepare(`
    INSERT INTO price_candle (
      symbol, trade_date, open, high, low, close, volume, adjusted, fetched_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
    ON CONFLICT(symbol, trade_date) DO UPDATE SET
      open       = excluded.open,
      high       = excluded.high,
      low        = excluded.low,
      close      = excluded.close,
      volume     = excluded.volume,
      fetched_at = excluded.fetched_at
  `);

  const run = db.transaction((batch: readonly Candle[]) => {
    for (const c of batch) {
      stmt.run(symbol, c.date, c.open, c.high, c.low, c.close, c.volume, fetchedAt);
    }
    return batch.length;
  });

  return run(candles);
}

/** 최신 `limit` 봉을 **과거 → 최신 오름차순**으로 (지표 엔진의 입력 형태) */
export function getCandles(db: Database, symbol: string, limit: number): Candle[] {
  const rows = db
    .prepare<[string, number], Candle & { trade_date: string }>(
      `SELECT trade_date, open, high, low, close, volume
         FROM price_candle
        WHERE symbol = ?
        ORDER BY trade_date DESC
        LIMIT ?`,
    )
    .all(symbol, limit);

  return rows
    .map((r) => ({
      date: r.trade_date,
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
      volume: r.volume,
    }))
    .reverse();
}

export function countCandles(db: Database, symbol: string): number {
  return db
    .prepare<[string], { c: number }>(
      "SELECT COUNT(*) AS c FROM price_candle WHERE symbol = ?",
    )
    .get(symbol)!.c;
}

/** 캐시 신선도 판정용. 가장 최근 거래일과 적재 시각 */
export function candleCacheState(
  db: Database,
  symbol: string,
): { latestTradeDate: string; fetchedAt: string } | null {
  return (
    db
      .prepare<[string], { latestTradeDate: string; fetchedAt: string }>(
        `SELECT trade_date AS latestTradeDate, fetched_at AS fetchedAt
           FROM price_candle
          WHERE symbol = ?
          ORDER BY trade_date DESC
          LIMIT 1`,
      )
      .get(symbol) ?? null
  );
}

/** 액면분할 감지 시 심볼 캐시를 통째로 버린다 (§12.2) */
export function purgeCandles(db: Database, symbol: string): number {
  return db.prepare("DELETE FROM price_candle WHERE symbol = ?").run(symbol).changes;
}

// ── 조회 이력 (캐시 워밍 대상 선별, §10.4) ──────────────────────────

export function recordAccess(db: Database, symbol: string, at: string): void {
  db.prepare(
    `INSERT INTO symbol_access (symbol, last_seen_at, hit_count)
     VALUES (?, ?, 1)
     ON CONFLICT(symbol) DO UPDATE SET
       last_seen_at = excluded.last_seen_at,
       hit_count    = symbol_access.hit_count + 1`,
  ).run(symbol, at);
}

/** 최근 N일 내 조회된 종목. 장 마감 후 프리워밍 배치의 대상이다 */
export function recentlyAccessedSymbols(db: Database, since: string): string[] {
  return db
    .prepare<[string], { symbol: string }>(
      "SELECT symbol FROM symbol_access WHERE last_seen_at >= ? ORDER BY hit_count DESC",
    )
    .all(since)
    .map((r) => r.symbol);
}

// ── 토큰 저장소 (§6.1 toss_token) ───────────────────────────────────

/**
 * `TokenStore` 의 DB 구현.
 *
 * 🔒 이 테이블 값은 응답 본문·로그·에러 메시지에 절대 노출되지 않는다 (§11.1).
 * 프로세스가 재시작해도 토큰을 재발급하지 않게 해 AUTH(5 TPS)를 아낀다.
 */
export function readToken(
  db: Database,
): { accessToken: string; expiresAt: number } | null {
  const row = db
    .prepare<[], { access_token: string; expires_at: string }>(
      "SELECT access_token, expires_at FROM toss_token WHERE id = 1",
    )
    .get();

  if (row === undefined) return null;
  const expiresAt = Date.parse(row.expires_at);
  if (Number.isNaN(expiresAt)) return null;

  return { accessToken: row.access_token, expiresAt };
}

export function writeToken(
  db: Database,
  token: { accessToken: string; expiresAt: number },
): void {
  db.prepare(
    `INSERT INTO toss_token (id, access_token, expires_at)
     VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       access_token = excluded.access_token,
       expires_at   = excluded.expires_at`,
  ).run(token.accessToken, new Date(token.expiresAt).toISOString());
}
