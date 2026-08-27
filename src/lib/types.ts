/**
 * 프론트 ↔ 우리 서버 API 계약 (PRD §6.4)
 *
 * 프론트는 토스 API를 절대 직접 호출하지 않는다. 이 형태만 받는다.
 */

import type { ExplanationSet } from "./templates";

/** PRD §7.3 — 6구간 신체 매핑 */
export type BodyZone = "FOOT" | "KNEE" | "WAIST" | "CHEST" | "SHOULDER" | "HEAD";

/** PRD §7.3 표기 순서 (아래 → 위). 정렬·순회에 쓴다 */
export const BODY_ZONES: readonly BodyZone[] = [
  "FOOT",
  "KNEE",
  "WAIST",
  "CHEST",
  "SHOULDER",
  "HEAD",
] as const;

/** PRD §4.1 F-POS-04 — 기간 토글. 기본값 120 */
export type PeriodDays = 60 | 120 | 250;
export const PERIOD_OPTIONS: readonly PeriodDays[] = [60, 120, 250] as const;
export const DEFAULT_PERIOD: PeriodDays = 120;

export type Market = "KR" | "US";
export type Currency = "KRW" | "USD";

/** 일봉 1개. 수정주가 기준 (PRD §7.1) */
export interface Candle {
  /** 거래일 'YYYY-MM-DD' */
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * 위치 계산 결과 (PRD §6.4 position)
 *
 * `available: false` 일 때 percentile/zone 등은 전부 null 이다.
 * 계산할 수 없다는 사실과 그 사유를 숨기지 않는다 (PP-03).
 */
export interface PositionBlock {
  available: boolean;
  reason?: "INSUFFICIENT_DATA" | "HALTED";
  /** 실제로 계산에 사용된 기간. 자동 강등되었다면 요청값과 다르다 (§7.7) */
  periodDays: PeriodDays;
  /** 요청된 기간. periodDays 와 다르면 강등이 일어난 것 */
  requestedPeriodDays: PeriodDays;
  /** 강등 여부. true 면 UI가 반드시 사유를 안내해야 한다 (§7.7, PP-03) */
  downgraded: boolean;
  /** 계산에 사용된 실제 봉 수 */
  dataPoints: number;
  /** 0~100. midrank 퍼센타일 (§7.2) */
  percentile: number | null;
  /** 히스테리시스가 적용되지 않은 raw 구간. 라벨 보정은 클라이언트가 한다 (E-02) */
  zone: BodyZone | null;
  periodHigh: number | null;
  periodLow: number | null;
  periodStartDate: string | null;
  /**
   * 기간 내 모든 종가가 동일한 경우 (§12.1).
   * midrank 덕에 division by zero 는 없지만 위치 해석이 무의미하므로 주석을 붙인다.
   */
  flatPrices: boolean;
}

/** 교차 정보 (PRD §7.5). 이격 필터·유효기간을 통과한 것만 존재한다 */
export interface CrossInfo {
  type: "GOLDEN" | "DEAD";
  date: string;
  daysAgo: number;
  /** 필터가 아니라 표시용. false 여도 교차는 표시하되 배지를 붙인다 (§7.5 3단계) */
  volumeConfirmed: boolean;
}

/** 추세 계산 결과 (PRD §6.4 trend). 기간 토글과 무관하다 — MA20/60 고정 */
export interface TrendBlock {
  available: boolean;
  reason?: "INSUFFICIENT_DATA" | "HALTED";
  maShort: number | null;
  maLong: number | null;
  /** 정배열(UP) / 역배열(DOWN). available 이면 항상 값이 있다 (F-TREND-02) */
  alignment: "UP" | "DOWN" | null;
  /** (maShort - maLong) / maLong */
  gapRatio: number | null;
  cross: CrossInfo | null;
  /** 화면 3 미니 차트용 최근 60일 (§5.4-a) */
  maSeries: { date: string; short: number; long: number }[];
}

export interface StockWarning {
  code: string;
  label: string;
  /** 거래정지·정리매매는 계산 자체를 막는다 (§12.1) */
  blocksAnalysis: boolean;
}

export interface PriceBlock {
  current: number;
  changeAmount: number;
  changeRate: number;
  /** ISO 8601 */
  asOf: string;
  /** 장중이면 true. "실시간" 표기는 이 값이 true 일 때만 허용 (§10.5, PP-03) */
  isRealtime: boolean;
  /** 'OPEN' | 'CLOSED' | 'HOLIDAY' — 화면 문구가 갈린다 (§12.3) */
  marketState: "OPEN" | "CLOSED" | "HOLIDAY";
}

/**
 * GET /api/stock/{symbol}?period=120
 *
 * ⚠️ 계약 확장 E-01: PRD §6.4 의 `position` 단일 객체 대신 세 기간을 모두 담는다.
 *    250봉 하나로 60/120/250 이 전부 계산되므로(§8.2), 한 응답에 담으면
 *    기간 토글이 네트워크 0회 · 순수 렌더가 된다.
 *    §14.2 의 "기간 토글 반영 < 100ms" 목표는 이 방식이라야 달성 가능하다.
 */
export interface StockAnalysisResponse {
  symbol: string;
  name: string;
  market: Market;
  currency: Currency;
  price: PriceBlock;
  /** 요청된 기본 기간. 클라이언트 토글의 초기값 */
  selectedPeriod: PeriodDays;
  /** 세 기간 전부 (E-01) */
  positions: Record<PeriodDays, PositionBlock>;
  trend: TrendBlock;
  warnings: StockWarning[];
  /**
   * 기간별 템플릿 문장 (§7.6). 토글해도 문장이 즉시 바뀌어야 하므로 기간별로 담는다.
   * 위치 문장과 추세 문장이 분리된 구조인 것은 R-01(접속사 금지)을 타입으로
   * 강제하기 위해서다. templates.ts 주석 참조.
   */
  explanations: Record<PeriodDays, ExplanationSet>;
  /** 캔들 데이터의 기준 시각 — PP-03 */
  dataAsOf: string;
}

/** GET /api/watchlist?symbols=...&period=120 */
export interface WatchlistResponse {
  items: WatchlistItem[];
}

export interface WatchlistItem {
  symbol: string;
  name: string;
  market: Market;
  currency: Currency;
  /**
   * KR·US 혼재 시 리스트 상단 일괄 시각을 표시하면 오해를 부른다 (§12.3).
   * 기준 시각은 반드시 행 단위로 가진다.
   */
  asOf: string;
  marketState: "OPEN" | "CLOSED" | "HOLIDAY";
  price: { current: number; changeRate: number } | null;
  position: { percentile: number | null; zone: BodyZone | null } | null;
  trend: {
    alignment: "UP" | "DOWN" | null;
    crossType: "GOLDEN" | "DEAD" | null;
    crossDaysAgo: number | null;
  } | null;
  /** 개별 종목 실패. 이 행만 에러로 표시하고 전체를 에러로 만들지 않는다 (§12.4) */
  error?: string;
}

/** 검색 인덱스 1건 (GET /api/search-index) */
export interface SearchIndexEntry {
  symbol: string;
  nameKo: string;
  nameEn: string;
  /** 초성. 'ㅅㅅㅈㅈ' (F-SEARCH-03) */
  initials: string;
  market: Market;
  exchange: string;
  listingStatus: "LISTED" | "DELISTED" | "SUSPENDED";
}

/** 사용자에게 노출되는 에러 코드 (PRD §11.3) */
export type ClientErrorCode =
  | "NOT_FOUND"
  | "BUSY"
  | "UPSTREAM_ERROR"
  | "TIMEOUT"
  | "CONFIG_ERROR"
  | "INVALID_REQUEST";

export interface ApiErrorResponse {
  error: { code: ClientErrorCode; message: string };
}
