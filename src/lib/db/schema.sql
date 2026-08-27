-- POSTURE 서버 캐시 스키마 (PRD §6.1)
--
-- Phase 1 은 사용자 계정이 없고 관심종목이 로컬에 저장되므로,
-- 영속 DB 가 필요한 것은 시세 캐시뿐이다.
--
-- SQLite 매핑 (PRD §6.1 은 Postgres 표기):
--   TIMESTAMPTZ  → TEXT  (ISO 8601 UTC 문자열)
--   NUMERIC(p,s) → REAL
--   BIGINT       → INTEGER
--   BOOLEAN      → INTEGER (0/1)
-- 컬럼명·PK·인덱스는 §6.1 과 동일하게 유지해 Postgres 전환 시 이관 비용을 없앤다.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- 종목 마스터 (일 1회 배치 동기화)
CREATE TABLE IF NOT EXISTS stock (
  symbol          TEXT PRIMARY KEY,        -- '005930', 'AAPL'
  name_ko         TEXT,                    -- '삼성전자'
  name_en         TEXT,                    -- 'Samsung Electronics'
  initials        TEXT,                    -- 'ㅅㅅㅈㅈ' (초성 검색용, 사전 계산)
  market          TEXT NOT NULL,           -- 'KR' | 'US'
  exchange        TEXT,                    -- 'KRX' | 'NASDAQ' | 'NYSE' ...
  currency        TEXT NOT NULL,           -- 'KRW' | 'USD'
  listing_status  TEXT NOT NULL,           -- 'LISTED' | 'DELISTED' | 'SUSPENDED'
  shares_out      INTEGER,
  -- 검색 랭킹용 (§5.2). ETF/ETN·우선주를 보통주 뒤로 미는 데 쓴다.
  -- 인덱스를 중요도 순으로 구워두면 검색이 동점을 만났을 때 배열 순서만
  -- 보면 되므로, 클라이언트로 내려가는 페이로드가 늘지 않는다.
  security_type   TEXT,                    -- 'STOCK' | 'ETF' | 'ETN' | 'REIT' ...
  is_common_share INTEGER,                 -- 1 = 보통주, 0 = 우선주
  synced_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stock_search ON stock (market, listing_status);

-- 일봉 캐시 (수정주가 기준)
-- 🔑 이 앱의 핵심 캐시. 250봉을 한 번 받아두면 60/120/250 세 기간의
--    퍼센타일과 MA20/60·교차가 전부 이 하나의 배열에서 계산된다 (§8.2).
CREATE TABLE IF NOT EXISTS price_candle (
  symbol      TEXT NOT NULL,
  trade_date  TEXT NOT NULL,               -- 'YYYY-MM-DD' (거래일)
  open        REAL NOT NULL,
  high        REAL NOT NULL,
  low         REAL NOT NULL,
  close       REAL NOT NULL,
  volume      INTEGER NOT NULL,
  adjusted    INTEGER NOT NULL DEFAULT 1,
  fetched_at  TEXT NOT NULL,
  PRIMARY KEY (symbol, trade_date)
);
CREATE INDEX IF NOT EXISTS idx_candle_symbol_date ON price_candle (symbol, trade_date DESC);

-- 계산 결과 스냅샷 (선택적 최적화 — §6.1 주석 참조)
-- 캔들이 캐시에 있으면 계산은 수 밀리초면 끝나므로 Phase 1 에서는 없어도 동작한다.
-- 관심종목 20종목 동시 계산의 실측 응답 시간을 본 뒤 도입 여부를 정한다.
CREATE TABLE IF NOT EXISTS indicator_snapshot (
  symbol            TEXT NOT NULL,
  base_date         TEXT NOT NULL,
  period_days       INTEGER NOT NULL,      -- 60 | 120 | 250
  percentile        REAL,
  body_zone         TEXT,                  -- 'FOOT'|'KNEE'|'WAIST'|'CHEST'|'SHOULDER'|'HEAD'
  period_high       REAL,
  period_low        REAL,
  ma_short          REAL,
  ma_long           REAL,
  alignment         TEXT,                  -- 'UP' | 'DOWN'
  gap_ratio         REAL,
  cross_type        TEXT,                  -- 'GOLDEN' | 'DEAD' | NULL
  cross_date        TEXT,
  cross_days_ago    INTEGER,
  cross_vol_ok      INTEGER,
  data_points       INTEGER NOT NULL,
  computed_at       TEXT NOT NULL,
  PRIMARY KEY (symbol, base_date, period_days)
);

-- 토스 액세스 토큰 (단일 행)
-- 🔒 이 테이블의 값은 응답 본문·로그·에러 메시지에 절대 노출되지 않는다 (§11.1).
CREATE TABLE IF NOT EXISTS toss_token (
  id           INTEGER PRIMARY KEY DEFAULT 1,
  access_token TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  CHECK (id = 1)
);

-- 캐시 워밍 대상 선별용 (§10.4)
-- "최근 7일간 조회된 적 있는 종목"을 알아야 장 마감 후 배치 대상을 정할 수 있다.
-- 전 종목 프리워밍은 하지 않는다 (KRX+US 수천 종목 × 2회 = 낭비).
CREATE TABLE IF NOT EXISTS symbol_access (
  symbol       TEXT PRIMARY KEY,
  last_seen_at TEXT NOT NULL,
  hit_count    INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_access_recent ON symbol_access (last_seen_at DESC);
