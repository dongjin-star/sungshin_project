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

/**
 * PRD §4.1 F-POS-04 — 기간 토글.
 *
 * 2026-08-28 단기/중기/장기로 개편했다(기존 60/120/250거래일 창 방식에서).
 * 위치(퍼센타일 분포 창)와 흐름(이동평균 비교 쌍)이 **같은 세 숫자를 공유한다**
 * — 화면 2·3 모두 이 토글 하나로 움직이고, 두 화면에서 서로 다른 숫자 체계를
 * 따로 외울 필요가 없다.
 *
 *   단기(20)  위치: 최근 20거래일 분포     흐름: MA5  vs MA20
 *   중기(60)  위치: 최근 60거래일 분포     흐름: MA20 vs MA60
 *   장기(120) 위치: 최근 120거래일 분포    흐름: MA60 vs MA120
 *
 * 세 티어 모두 "분포/차트 창 길이 = 그 티어의 장기 이동평균 기간"이라는 규칙이
 * 성립한다 — 숫자를 하나 더 늘리지 않고 재사용한 이유다.
 */
export type PeriodDays = 20 | 60 | 120;
export const PERIOD_OPTIONS: readonly PeriodDays[] = [20, 60, 120] as const;
export const DEFAULT_PERIOD: PeriodDays = 60;

/** 토글 표시 라벨. 화면에는 거래일 수가 아니라 이 이름이 보인다 */
export const PERIOD_LABEL: Record<PeriodDays, string> = {
  20: "단기",
  60: "중기",
  120: "장기",
};

/** 각 기간에서 비교하는 이동평균 쌍 */
export interface MaPair {
  short: number;
  long: number;
}

export const MA_PAIR_OF: Record<PeriodDays, MaPair> = {
  20: { short: 5, long: 20 },
  60: { short: 20, long: 60 },
  120: { short: 60, long: 120 },
};

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

/**
 * 추세 계산 결과 (PRD §6.4 trend). **기간(티어)마다 하나씩** 나온다.
 *
 * 2026-08-28 개편: 이제 기간 토글이 비교 대상 MA 쌍 자체를 바꾼다
 * (`MA_PAIR_OF`, 위 `PeriodDays` 주석 참고) — 단기는 MA5 vs MA20, 중기는
 * MA20 vs MA60, 장기는 MA60 vs MA120. 그래서 `TrendBlock` 하나가 "그 티어
 * 하나의 흐름"을 완전히 나타내고, `StockAnalysisResponse.trend` 가 세 티어를
 * `Record` 로 담는다 — `positions`·`explanations` 와 같은 이유다: 세 티어를
 * 한 응답에 다 담아야 토글이 네트워크 0회·순수 렌더로 끝난다 (계약 확장 E-01).
 *
 * `maShortPeriod`/`maLongPeriod` 를 값으로 들고 다니는 이유: 화면이 "20일
 * 평균"·"MA5" 같은 라벨을 하드코딩하지 않고 이 값으로 조립하게 하기 위해서다
 * — 티어마다 실제 숫자가 다르므로 문구를 고정하면 셋 중 둘은 거짓말이 된다.
 */
export interface TrendBlock {
  available: boolean;
  reason?: "INSUFFICIENT_DATA" | "HALTED";
  /** 이 블록이 비교하는 짧은 쪽 MA 기간 (5, 20, 60 중 하나) */
  maShortPeriod: number;
  /** 이 블록이 비교하는 긴 쪽 MA 기간 (20, 60, 120 중 하나) */
  maLongPeriod: number;
  maShort: number | null;
  maLong: number | null;
  /** 정배열(UP) / 역배열(DOWN). available 이면 항상 값이 있다 (F-TREND-02) */
  alignment: "UP" | "DOWN" | null;
  /** (maShort - maLong) / maLong */
  gapRatio: number | null;
  cross: CrossInfo | null;
  /** 화면 3 미니 차트용 시계열. 창 길이 = maLongPeriod (§5.4-a) */
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
 * GET /api/stock/{symbol}?period=60
 *
 * ⚠️ 계약 확장 E-01: PRD §6.4 의 `position` 단일 객체 대신 세 기간을 모두 담는다.
 *    250봉 하나로 단기/중기/장기가 전부 계산되므로(§8.2), 한 응답에 담으면
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
  /** 세 기간 전부 — 기간마다 비교하는 MA 쌍 자체가 다르다 (E-01과 같은 이유) */
  trend: Record<PeriodDays, TrendBlock>;
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

/**
 * GET /api/stock/{symbol}/explain — "쉬운 설명" 탭 AI 부연 설명 (D-04).
 *
 * 위치·흐름 문장을 하나로 합치지 않는 R-01 원칙을 여기서도 유지한다 —
 * 그래서 필드가 둘로 나뉜다. 계산 불가였던 쪽은 null이다.
 */
export interface PlainExplanationResponse {
  positionDetail: string | null;
  trendDetail: string | null;
}
