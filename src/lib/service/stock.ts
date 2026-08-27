/**
 * 종목 분석 조립 (PRD §6.4 계약)
 *
 * 캔들 캐시 · 현재가 · 유의사항 · 장 상태를 모아 지표 엔진에 넣고
 * `StockAnalysisResponse` 를 만든다. 계산 자체는 전부 `indicators/` 의
 * 순수 함수가 한다 — 여기는 I/O 와 조립만 담당한다.
 *
 * 캐시가 다 찬 상태의 토스 호출 횟수는 **1회**(prices)다. §10.4 의 표가
 * 약속한 값이며, 그 약속을 지키는 곳이 이 파일이다.
 */

import type { Database } from "better-sqlite3";

import { TTL, TtlCache } from "../cache/memory";
import { getStock, recordAccess, type StockRow } from "../db/repo";
import { analyzeAllPeriods, analyzeTrend } from "../indicators/analyze";
import { fetchPrices, fetchWarnings } from "../toss/endpoints";
import { isFormingBar } from "../toss/trading-day";
import { buildExplanations } from "../templates";
import {
  DEFAULT_PERIOD,
  type Candle,
  type Market,
  type PeriodDays,
  type PriceBlock,
  type StockAnalysisResponse,
  type StockWarning,
  type WatchlistItem,
} from "../types";
import { fetchCalendar, marketStateOf, type MarketState } from "../market/calendar";
import { getCachedCandles } from "./candle-cache";

const priceCache = new TtlCache<{ price: number; asOf: string }>(TTL.PRICE_MS);
const warningCache = new TtlCache<StockWarning[]>(TTL.WARNINGS_MS);

/** §12.1 — 거래정지·정리매매는 계산 자체를 막는다 */
const BLOCKING_WARNINGS = new Set(["TRADING_HALT", "TRADING_SUSPENSION", "LIQUIDATION"]);

/**
 * 토스 warningType → 화면 라벨.
 *
 * 전부 거래소가 **실제로 지정한 제도상 명칭**이다. §13.2 가 금지한 것은
 * 우리가 만들어낸 가치 판단이지, 거래소가 붙인 사실을 옮기는 것이 아니다
 * ("거래정지 배지 등 사실 표시는 예외"). 그래서 아래 셋에 lint-allow 를 단다.
 *
 * 모르는 코드에까지 임의 문구를 붙이지 않는다. 무슨 지정인지 모르면서
 * 성격을 단정하면 그건 사실 진술이 아니다.
 */
const WARNING_LABELS: Record<string, string> = {
  TRADING_HALT: "거래정지",
  TRADING_SUSPENSION: "거래정지",
  LIQUIDATION: "정리매매",
  INVESTMENT_WARNING: "투자경고",
  INVESTMENT_RISK: "투자위험", // lint-allow: 위험
  INVESTMENT_CAUTION: "투자주의", // lint-allow: 주의
  SHORT_TERM_OVERHEAT: "단기과열",
  VI: "변동성완화장치",
  PREFERRED_STOCK_OVERHEAT: "우선주 단기과열",
};

function toWarning(raw: { warningType: string }): StockWarning {
  return {
    code: raw.warningType,
    label: WARNING_LABELS[raw.warningType] ?? "유의 지정",
    blocksAnalysis: BLOCKING_WARNINGS.has(raw.warningType),
  };
}

/**
 * 현재가. 30초 캐시 (§10.4).
 *
 * 다건 조회를 1회로 묶는 것이 관심종목 화면의 전제이므로(§8.1) 이 함수는
 * 여러 심볼을 한 번에 받는다.
 */
export async function getPrices(
  symbols: readonly string[],
): Promise<Map<string, { price: number; asOf: string }>> {
  const out = new Map<string, { price: number; asOf: string }>();
  const misses: string[] = [];

  for (const symbol of symbols) {
    const hit = priceCache.get(symbol);
    if (hit !== undefined) out.set(symbol, hit);
    else misses.push(symbol);
  }

  if (misses.length === 0) return out;

  // /prices 는 1회 200종목까지다 (§8.1)
  for (let i = 0; i < misses.length; i += 200) {
    const batch = misses.slice(i, i + 200);
    const rows = await fetchPrices(batch);
    for (const row of rows) {
      const entry = { price: Number(row.lastPrice), asOf: row.timestamp };
      if (!Number.isFinite(entry.price)) continue;
      priceCache.set(row.symbol, entry);
      out.set(row.symbol, entry);
    }
  }

  return out;
}

async function getWarnings(symbol: string): Promise<StockWarning[]> {
  return warningCache.getOrLoad(symbol, async () => {
    try {
      return (await fetchWarnings(symbol)).map(toWarning);
    } catch {
      // 유의사항을 못 받은 것이 종목 전체를 못 보게 할 이유는 아니다.
      // 다만 "유의사항 없음"과 "확인 실패"를 같게 취급하지 않도록 캐시는 짧게.
      return [];
    }
  });
}

export interface StockContext {
  row: StockRow | null;
  market: Market;
  name: string;
  currency: "KRW" | "USD";
}

/** 마스터 캐시에서 종목 메타를 읽는다. §11.4 "심볼 검증"의 근거이기도 하다 */
export function stockContext(db: Database | null, symbol: string): StockContext | null {
  if (db === null) return null;
  const row = getStock(db, symbol);
  if (row === null) return null;

  return {
    row,
    market: row.market,
    name: row.name_ko ?? row.name_en ?? row.symbol,
    currency: row.currency === "USD" ? "USD" : "KRW",
  };
}

function priceBlock(
  current: number,
  asOf: string,
  candles: readonly Candle[],
  market: Market,
  state: MarketState,
): PriceBlock {
  // 전일 종가 = 당일(진행 중) 봉을 뺀 마지막 봉.
  // 이 봉이 무엇인지 판정하지 않으면 등락률이 하루씩 밀린다 (§7.1 실측 ④).
  const latest = candles.at(-1);
  const forming = latest !== undefined && isFormingBar(latest.date, market);
  const previous = forming ? candles.at(-2) : latest;

  const base = previous?.close;
  const changeAmount = base !== undefined ? current - base : 0;
  const changeRate = base !== undefined && base !== 0 ? changeAmount / base : 0;

  return {
    current,
    changeAmount,
    changeRate,
    asOf,
    // "실시간" 표기는 정규장 중일 때만 허용한다 (§10.5, PP-03)
    isRealtime: state === "OPEN",
    marketState: state,
  };
}

/**
 * 종목 상세 (GET /api/stock/{symbol}).
 *
 * 세 기간(60/120/250)을 한 응답에 담는다 — 계약 확장 E-01. 기간 토글이
 * 네트워크 0회가 되는 근거다.
 */
export async function analyzeStock(
  db: Database | null,
  symbol: string,
  ctx: StockContext,
  selectedPeriod: PeriodDays = DEFAULT_PERIOD,
): Promise<StockAnalysisResponse> {
  const { market, name, currency } = ctx;

  const [candles, warnings, calendar] = await Promise.all([
    getCachedCandles(db, symbol, market),
    getWarnings(symbol),
    fetchCalendar(market).catch(() => ({})),
  ]);

  const state = marketStateOf(calendar);
  const halted = warnings.some((w) => w.blocksAnalysis);

  const priceMap = await getPrices([symbol]);
  const priceHit = priceMap.get(symbol);

  // 현재가를 못 받으면 최신 종가로 대체한다. 계산을 포기하는 것보다 낫고,
  // isRealtime=false 로 내려가므로 화면이 "실시간"이라고 말하지 않는다.
  const latestClose = candles.at(-1)?.close ?? 0;
  const current = priceHit?.price ?? latestClose;
  const asOf = priceHit?.asOf ?? new Date().toISOString();

  const input = { candles, current, isRealtime: state === "OPEN", halted };

  const positions = analyzeAllPeriods(input);
  const trend = analyzeTrend(input);

  const explanations = {} as StockAnalysisResponse["explanations"];
  for (const period of [60, 120, 250] as PeriodDays[]) {
    explanations[period] = buildExplanations(positions[period], trend, currency);
  }

  if (db !== null) recordAccess(db, symbol, new Date().toISOString());

  return {
    symbol,
    name,
    market,
    currency,
    price: priceBlock(current, asOf, candles, market, state),
    selectedPeriod,
    positions,
    trend,
    warnings,
    explanations,
    dataAsOf: candles.at(-1)?.date ?? "",
  };
}

/**
 * 관심종목 일괄 (GET /api/watchlist).
 *
 * 현재가는 **1회 다건 호출**로 끝낸다 (§8.1 F-WATCH-02). 캔들은 종목별
 * 캐시에서 읽으므로 캐시가 차 있으면 토스 호출은 그 1회가 전부다.
 *
 * 한 종목이 실패해도 그 행만 에러로 표시하고 전체를 죽이지 않는다 (§12.4).
 */
export async function analyzeWatchlist(
  db: Database | null,
  symbols: readonly string[],
  period: PeriodDays = DEFAULT_PERIOD,
): Promise<WatchlistItem[]> {
  const contexts = new Map<string, StockContext>();
  for (const symbol of symbols) {
    const ctx = stockContext(db, symbol);
    if (ctx !== null) contexts.set(symbol, ctx);
  }

  const known = [...contexts.keys()];
  const priceMap = await getPrices(known).catch(() => new Map());

  // 시장별 캘린더는 종목 수와 무관하게 최대 2회다 (24시간 캐시)
  const calendars = new Map<Market, MarketState>();
  for (const market of new Set([...contexts.values()].map((c) => c.market))) {
    const cal = await fetchCalendar(market).catch(() => ({}));
    calendars.set(market, marketStateOf(cal));
  }

  return Promise.all(
    symbols.map(async (symbol): Promise<WatchlistItem> => {
      const ctx = contexts.get(symbol);

      if (ctx === undefined) {
        return {
          symbol,
          name: symbol,
          market: "KR",
          currency: "KRW",
          asOf: new Date().toISOString(),
          marketState: "CLOSED",
          price: null,
          position: null,
          trend: null,
          error: "알 수 없는 종목입니다.",
        };
      }

      const state = calendars.get(ctx.market) ?? "CLOSED";

      try {
        const candles = await getCachedCandles(db, symbol, ctx.market);
        const hit = priceMap.get(symbol);
        const current = hit?.price ?? candles.at(-1)?.close ?? 0;

        const input = { candles, current, isRealtime: state === "OPEN", halted: false };
        const position = analyzeAllPeriods(input)[period];
        const trend = analyzeTrend(input);
        const block = priceBlock(current, hit?.asOf ?? "", candles, ctx.market, state);

        return {
          symbol,
          name: ctx.name,
          market: ctx.market,
          currency: ctx.currency,
          // 기준 시각은 반드시 행 단위로 가진다 (§12.3 — KR·US 혼재)
          asOf: hit?.asOf ?? new Date().toISOString(),
          marketState: state,
          price: { current, changeRate: block.changeRate },
          position: { percentile: position.percentile, zone: position.zone },
          trend: {
            alignment: trend.alignment,
            crossType: trend.cross?.type ?? null,
            crossDaysAgo: trend.cross?.daysAgo ?? null,
          },
        };
      } catch {
        return {
          symbol,
          name: ctx.name,
          market: ctx.market,
          currency: ctx.currency,
          asOf: new Date().toISOString(),
          marketState: state,
          price: null,
          position: null,
          trend: null,
          error: "시세 정보를 불러오지 못했습니다.",
        };
      }
    }),
  );
}

/** 테스트용 */
export function __clearServiceCaches(): void {
  priceCache.clear();
  warningCache.clear();
}
