/**
 * 거래일 인덱싱 (PRD §7.1 — Phase 0-4 실측으로 확정)
 *
 * ── 실측 사실 (2026-08-27, docs/probe/candles-*.json) ──────────────
 *
 * 토스는 일봉 `timestamp` 를 **항상 `+09:00` 오프셋 문자열**로 내려준다.
 * 그런데 오프셋만 고정일 뿐, 벽시계 시각은 종목의 시장에 따라 다르다.
 *
 *   005930 : "2026-08-27T00:00:00.000+09:00"   → 자정 KST
 *   AAPL   : "2026-08-27T13:00:00.000+09:00"   → 13시 KST = 자정 EDT
 *   AAPL   : "2026-03-06T14:00:00.000+09:00"   → 14시 KST = 자정 EST
 *
 * AAPL 200봉의 시각 분포가 13:00(120봉, 2026-03-09~) / 14:00(80봉, ~2026-03-06)
 * 둘로 정확히 갈리고, 그 경계가 2026-03-08 미국 서머타임 시작일과 일치한다.
 * 즉 **미국 종목의 timestamp 는 "America/New_York 자정"을 KST 오프셋으로
 * 표기한 값**이다. 오프셋 문자열(+09:00)은 시장을 알려주지 않는다.
 *
 * ── 그래서 규칙 ────────────────────────────────────────────────────
 *
 * 거래일은 **시장 현지 타임존으로 환산한 날짜**다. 문자열을 자르거나
 * UTC 로 환산하지 않는다. 지금은 13/14시 KST 가 우연히 같은 날짜라
 * `slice(0,10)` 도 같은 답을 내지만, 그건 자정 ET + 13~14시간이 당일을
 * 넘지 않는다는 우연에 기댄 것이다. 토스가 오프셋 표기를 바꾸는 순간
 * 조용히 하루씩 어긋난다. 시장 타임존으로 환산하는 쪽이 의미에 맞다.
 */

import type { Market } from "../types";

/** 시장별 현지 타임존. 거래일 판정의 유일한 기준이다 */
export const MARKET_TIMEZONE: Record<Market, string> = {
  KR: "Asia/Seoul",
  US: "America/New_York",
};

/** 토스 `market` (시장 세그먼트) → 우리 `Market` */
export const MARKET_OF_SEGMENT: Record<string, Market> = {
  KOSPI: "KR",
  KOSDAQ: "KR",
  KR_ETC: "KR",
  NYSE: "US",
  NASDAQ: "US",
  AMEX: "US",
  US_ETC: "US",
};

/** en-CA 로케일은 'YYYY-MM-DD' 를 준다. 포맷터는 만드는 비용이 있어 캐시한다 */
const dateFormatters = new Map<string, Intl.DateTimeFormat>();

function dateFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = dateFormatters.get(timeZone);
  if (fmt === undefined) {
    fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    dateFormatters.set(timeZone, fmt);
  }
  return fmt;
}

/**
 * 토스 timestamp → 거래일 'YYYY-MM-DD'.
 *
 * @param timestamp ISO 8601 문자열 (토스는 `+09:00` 로 내려준다)
 * @param market    종목이 상장된 시장. **이 값이 없으면 날짜를 정할 수 없다**
 */
export function tradeDateOf(timestamp: string, market: Market): string {
  const instant = new Date(timestamp);
  if (Number.isNaN(instant.getTime())) {
    throw new Error(`거래일로 환산할 수 없는 timestamp: ${timestamp}`);
  }
  return dateFormatter(MARKET_TIMEZONE[market]).format(instant);
}

/** 해당 시장의 '오늘' (현지 날짜). 당일 봉 판정에 쓴다 */
export function todayInMarket(market: Market, now: Date = new Date()): string {
  return dateFormatter(MARKET_TIMEZONE[market]).format(now);
}

/**
 * 심볼로 시장을 추정한다.
 *
 * 국내 종목 코드는 6자리 숫자다. 마스터 캐시에 종목이 있으면 그쪽 `market`
 * 컬럼이 정답이므로 이 함수를 쓰지 않는다. 캐시 미스 상태에서 캔들을
 * 먼저 받아야 할 때의 폴백이다.
 */
export function inferMarket(symbol: string): Market {
  return /^\d{6}$/.test(symbol) ? "KR" : "US";
}

/**
 * 최신 봉이 **아직 마감되지 않은 당일 봉**인지 판정한다.
 *
 * ── 왜 필요한가 (실측 근거) ────────────────────────────────────────
 * 프로브를 3분 간격으로 두 번 돌렸더니 같은 날짜의 최신 봉이 바뀌었다.
 *
 *   AAPL 2026-08-27 : close 310.61 → 310.69, volume 93,043 → 93,076
 *
 * 그 시점 미국 정규장은 열리지도 않았고(개장 22:30 KST), 거래량은 직전
 * 20봉 중앙값의 **0.2%** 였다. 프리마켓 체결이 실시간으로 누적되는
 * 미완성 봉이라는 뜻이다. 국내도 같다 — 005930 의 당일 봉은 15:19 시점
 * 중앙값의 57% 였고 종가가 그때의 현재가와 일치했다.
 *
 * 즉 **캔들 배열의 마지막 원소는 "어제 종가"가 아니라 "오늘 진행 중인 봉"**
 * 일 수 있다. §7.1 이 분포에서 당일을 제외하라고 한 것이 바로 이 봉이고,
 * §7.4 가 장중에 최신 봉 종가를 현재가로 대입한다고 한 것도 이 봉이다.
 * 두 규칙 모두 "마지막 원소 = 당일"을 전제하므로, 그 전제가 실제로
 * 성립하는지 확인할 수단이 있어야 한다.
 */
export function isFormingBar(
  latestTradeDate: string,
  market: Market,
  now: Date = new Date(),
): boolean {
  return latestTradeDate === todayInMarket(market, now);
}
