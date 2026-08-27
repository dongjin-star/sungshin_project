/**
 * 토스 엔드포인트 래퍼 (PRD §8.1 매핑)
 *
 * 각 함수는 §8.4 의 rate limit 그룹을 하나씩 못박는다. 호출부가 그룹을
 * 고르게 두면 언젠가 STOCK_ALL(1 TPS) 이 사용자 요청 경로에 섞인다.
 *
 * ⚠️ client 가 아니라 core 를 import 한다 — 이유는 core.ts 상단 주석 참조.
 */

import { tossGet } from "./core";
import { MARKET_OF_SEGMENT, tradeDateOf } from "./trading-day";
import type { Candle, Market } from "../types";

/** 토스 시장 세그먼트. `/stocks/all` 의 필수 파라미터다 */
export const MARKET_SEGMENTS = [
  "KOSPI",
  "KOSDAQ",
  "NYSE",
  "NASDAQ",
  "AMEX",
  "KR_ETC",
  "US_ETC",
] as const;

export type MarketSegment = (typeof MARKET_SEGMENTS)[number];

/** `/stocks/all` 항목 (실측: symbol, name, securityType, isCommonShare, isinCode) */
export interface ListedStock {
  symbol: string;
  name: string;
  securityType: string;
  isCommonShare: boolean;
  isinCode: string;
}

/** `/stocks?symbols=` 항목. `/stocks/all` 보다 필드가 훨씬 많다 */
export interface StockInfo {
  symbol: string;
  name: string;
  englishName: string | null;
  isinCode: string;
  market: MarketSegment;
  securityType: string;
  isCommonShare: boolean;
  status: "SCHEDULED" | "ACTIVE" | "DELISTED";
  currency: "KRW" | "USD";
  listDate: string | null;
  delistDate: string | null;
  sharesOutstanding: string | null;
}

/** `/candles` 항목. 가격·거래량이 **문자열**로 온다 (실측) */
interface RawCandle {
  timestamp: string;
  openPrice: string;
  highPrice: string;
  lowPrice: string;
  closePrice: string;
  volume: string;
  currency: string;
}

interface CandleResult {
  candles?: RawCandle[];
  nextBefore?: string | null;
}

export interface RawPrice {
  symbol: string;
  timestamp: string;
  lastPrice: string;
  currency: string;
}

/**
 * 시장별 상장 종목 목록.
 *
 * 🔴 STOCK_ALL 은 **1 TPS**. 절대 사용자 요청 경로에 두지 않는다 — 일 1회 배치 전용.
 *
 * ⚠️ Phase 0-4 실측 정정: `market` 은 **필수** 파라미터다. 생략하면
 *    400 `invalid-request` (field=market) 가 떨어진다. 전체 마스터는
 *    단일 호출이 아니라 세그먼트 수(7)만큼의 호출로 구성된다.
 */
export async function fetchListedStocks(
  segment: MarketSegment,
  status: "ACTIVE" | "DELISTED" | "SCHEDULED" = "ACTIVE",
): Promise<ListedStock[]> {
  const result = await tossGet<ListedStock[]>(
    `/api/v1/stocks/all?market=${segment}&status=${status}`,
    "STOCK_ALL",
  );
  return result ?? [];
}

/** `/stocks?symbols=` 의 1회 상한 (스펙 명시) */
export const SYMBOLS_PER_CALL = 200;

/**
 * 종목 상세 다건 조회. 최대 200건/회.
 *
 * `/stocks/all` 이 주지 않는 englishName·currency·status·sharesOutstanding
 * 을 여기서 채운다 (F-SEARCH-02 영문 검색의 근거 데이터).
 */
export async function fetchStockInfos(symbols: readonly string[]): Promise<StockInfo[]> {
  if (symbols.length === 0) return [];
  if (symbols.length > SYMBOLS_PER_CALL) {
    throw new Error(
      `symbols 는 1회 ${SYMBOLS_PER_CALL}건까지다 (요청 ${symbols.length}건). chunk 로 나눠 호출하라.`,
    );
  }
  const result = await tossGet<StockInfo[]>(
    `/api/v1/stocks?symbols=${symbols.join(",")}`,
    "STOCK",
  );
  return result ?? [];
}

/** `/candles` 1회 응답의 최대 봉 수 (§8.2) */
export const CANDLES_PER_CALL = 200;

/**
 * 일봉 1페이지.
 *
 * @param before `nextBefore` 커서. 타임존 오프셋의 '+' 가 `%2B` 로
 *               인코딩되어야 한다 — `encodeURIComponent` 가 처리한다 (§8.2).
 */
export async function fetchCandlePage(
  symbol: string,
  market: Market,
  count: number,
  before?: string,
): Promise<{ candles: Candle[]; nextBefore: string | null }> {
  const params = new URLSearchParams({
    symbol,
    interval: "1d",
    count: String(Math.min(count, CANDLES_PER_CALL)),
    adjusted: "true",
  });
  if (before !== undefined) params.set("before", before);

  const result = await tossGet<CandleResult>(
    `/api/v1/candles?${params.toString()}`,
    "MARKET_DATA_CHART",
  );

  const raw = result?.candles ?? [];
  return {
    // 거래일은 시장 현지 타임존으로 환산한다 — trading-day.ts 주석 참조
    candles: raw.map((c) => toCandle(c, market)),
    nextBefore: result?.nextBefore ?? null,
  };
}

function toCandle(raw: RawCandle, market: Market): Candle {
  return {
    date: tradeDateOf(raw.timestamp, market),
    open: Number(raw.openPrice),
    high: Number(raw.highPrice),
    low: Number(raw.lowPrice),
    close: Number(raw.closePrice),
    volume: Number(raw.volume),
  };
}

/** 현재가 다건. 최대 200종목 1회 호출 (§8.1) */
export async function fetchPrices(symbols: readonly string[]): Promise<RawPrice[]> {
  if (symbols.length === 0) return [];
  const result = await tossGet<RawPrice[]>(
    `/api/v1/prices?symbols=${symbols.join(",")}`,
    "MARKET_DATA",
  );
  return result ?? [];
}

/** 매수 유의사항 (F-STATE-02). 해당 없으면 빈 배열 */
export async function fetchWarnings(symbol: string): Promise<
  { warningType: string; exchange: string; startDate: string; endDate: string | null }[]
> {
  const result = await tossGet<
    { warningType: string; exchange: string; startDate: string; endDate: string | null }[]
  >(`/api/v1/stocks/${encodeURIComponent(symbol)}/warnings`, "STOCK");
  return result ?? [];
}

/** 시장 세그먼트 → KR/US. 마스터 적재 시 `market` 컬럼을 채운다 */
export function marketOf(segment: MarketSegment): Market {
  const market = MARKET_OF_SEGMENT[segment];
  if (market === undefined) throw new Error(`알 수 없는 시장 세그먼트: ${segment}`);
  return market;
}
