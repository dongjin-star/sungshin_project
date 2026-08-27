/**
 * 지표 엔진 오케스트레이션.
 *
 * 순수 함수다 — 네트워크도 DB도 시계도 만지지 않는다. 입력은 캔들 배열과
 * 현재가뿐이고, 출력은 §6.4 계약의 position/trend 블록이다.
 * 덕분에 손계산한 값과 대조하는 단위 테스트가 그대로 성립한다.
 *
 * 핵심: 250봉 하나로 60·120·250 세 기간의 퍼센타일과 MA20/60·교차가
 * 전부 계산된다 (§8.2). 그래서 기간 토글에 API 호출이 0회다.
 */

import type {
  BodyZone,
  Candle,
  PeriodDays,
  PositionBlock,
  TrendBlock,
} from "../types";
import { PERIOD_OPTIONS } from "../types";
import { isFlat, midrankPercentile } from "./percentile";
import { zoneOf } from "./zone";
import { MA_LONG, MA_SHORT, gapRatio, sma, withLiveClose } from "./ma";
import { detectCross } from "./cross";
import { canComputeTrend, resolvePeriod } from "./requirements";

export interface AnalyzeInput {
  /** 과거 → 최신 오름차순. 결측일(휴장·거래정지)은 이미 제외되어 있어야 한다 (§7.1) */
  candles: readonly Candle[];
  current: number;
  /** 장중 여부. true 면 최신 봉 종가를 현재가로 대체해 MA를 계산한다 (§7.4) */
  isRealtime: boolean;
  /** 거래정지·정리매매면 계산 자체를 수행하지 않는다 (§12.1) */
  halted: boolean;
}

/**
 * 한 기간에 대한 위치 계산.
 *
 * 분포에는 **당일을 포함하지 않는다** (§7.1). 직전 N거래일의 종가 분포와
 * 현재가를 비교하는 것이 정의다. 당일을 넣으면 현재가가 자기 자신과
 * 비교되어 표본이 오염된다.
 */
export function analyzePosition(
  input: AnalyzeInput,
  requested: PeriodDays,
): PositionBlock {
  const { candles, current, halted } = input;

  const unavailable = (
    reason: "INSUFFICIENT_DATA" | "HALTED",
    dataPoints: number,
  ): PositionBlock => ({
    available: false,
    reason,
    periodDays: requested,
    requestedPeriodDays: requested,
    downgraded: false,
    dataPoints,
    percentile: null,
    zone: null,
    periodHigh: null,
    periodLow: null,
    periodStartDate: null,
    flatPrices: false,
  });

  if (halted) return unavailable("HALTED", candles.length);

  // 당일(최신 봉)을 뺀 나머지가 분포의 모집단이다
  const history = candles.slice(0, -1);
  const resolution = resolvePeriod(requested, history.length);
  if (resolution.unavailable) {
    return unavailable("INSUFFICIENT_DATA", history.length);
  }

  // 직전 N거래일. 보유 봉이 N보다 적으면 있는 만큼 쓴다(강등 판정은 위에서 끝났다)
  const window = history.slice(-resolution.period);
  const closes = window.map((c) => c.close);

  const percentile = midrankPercentile(closes, current);
  const zone: BodyZone = zoneOf(percentile);

  return {
    available: true,
    periodDays: resolution.period,
    requestedPeriodDays: requested,
    downgraded: resolution.downgraded,
    dataPoints: closes.length,
    percentile,
    zone,
    // 최고가·최저가는 고가/저가 기준이다. 종가 분포(퍼센타일)와는 다른 것을 잰다.
    periodHigh: Math.max(...window.map((c) => c.high)),
    periodLow: Math.min(...window.map((c) => c.low)),
    periodStartDate: window[0]!.date,
    flatPrices: isFlat(closes),
  };
}

/**
 * 추세 계산.
 *
 * maShort/maLong/alignment/cross 는 기간 토글과 무관하다 — MA20/60 비교
 * 자체는 고정이다. `maSeries` 만 기간별로 갈라 담는다 (§5.4-a, `TrendBlock`
 * 주석 참고) — 세 기간을 한 번에 계산해 토글을 네트워크 0회로 만든다.
 */
export function analyzeTrend(input: AnalyzeInput): TrendBlock {
  const { candles, current, isRealtime, halted } = input;

  const emptyMaSeries = (): TrendBlock["maSeries"] => {
    const out = {} as TrendBlock["maSeries"];
    for (const period of PERIOD_OPTIONS) out[period] = [];
    return out;
  };

  const unavailable = (reason: "INSUFFICIENT_DATA" | "HALTED"): TrendBlock => ({
    available: false,
    reason,
    maShort: null,
    maLong: null,
    alignment: null,
    gapRatio: null,
    cross: null,
    maSeries: emptyMaSeries(),
  });

  if (halted) return unavailable("HALTED");
  if (!canComputeTrend(candles.length)) return unavailable("INSUFFICIENT_DATA");

  const dates = candles.map((c) => c.date);
  const volumes = candles.map((c) => c.volume);
  const closes = withLiveClose(
    candles.map((c) => c.close),
    current,
    isRealtime,
  );

  const shortSeries = sma(closes, MA_SHORT);
  const longSeries = sma(closes, MA_LONG);

  const last = closes.length - 1;
  const maShort = shortSeries[last];
  const maLong = longSeries[last];

  // canComputeTrend 를 통과했으므로 여기서 null 일 수 없다.
  if (maShort == null || maLong == null) return unavailable("INSUFFICIENT_DATA");

  const gap = gapRatio(maShort, maLong);

  // 배열 상태는 항상 값이 존재한다 (F-TREND-02).
  // 두 값이 정확히 같은 극단적 경우는 '정배열이 아님'으로 본다.
  const alignment: "UP" | "DOWN" = maShort > maLong ? "UP" : "DOWN";

  const cross = detectCross({ dates, maShort: shortSeries, maLong: longSeries, volumes });

  // 미니 차트용 시계열. 두 MA가 모두 잡히는 구간만 넘긴다. 기간 토글이
  // 고르는 건 "몇 거래일을 보여줄지"이지, MA20/60 이라는 비교 대상 자체가
  // 아니다 — 60일 창을 60일 SMA로 채우려는 게 아니라, 같은 MA20 vs MA60
  // 관계를 더 긴 시야에서 보여주는 것뿐이다.
  const maSeries = {} as TrendBlock["maSeries"];
  for (const period of PERIOD_OPTIONS) {
    const series: TrendBlock["maSeries"][PeriodDays] = [];
    for (let i = Math.max(0, closes.length - period); i <= last; i += 1) {
      const s = shortSeries[i];
      const l = longSeries[i];
      if (s == null || l == null) continue;
      series.push({ date: dates[i]!, short: s, long: l });
    }
    maSeries[period] = series;
  }

  return { available: true, maShort, maLong, alignment, gapRatio: gap, cross, maSeries };
}

/** 세 기간을 한 번에 계산한다 (계약 확장 E-01) */
export function analyzeAllPeriods(
  input: AnalyzeInput,
): Record<PeriodDays, PositionBlock> {
  const out = {} as Record<PeriodDays, PositionBlock>;
  for (const period of PERIOD_OPTIONS) {
    out[period] = analyzePosition(input, period);
  }
  return out;
}
