/**
 * 토스 클라이언트 — 앱 코드가 쓰는 유일한 진입점 (PRD §11.1)
 *
 * `import "server-only"` 가 1차 방어선이다. 클라이언트 컴포넌트가 이
 * 모듈을 import 하면 **빌드가 실패한다** (§11.2-1).
 *
 * 구현은 `core.ts`·`endpoints.ts`·`candles.ts` 에 있다. 배치 스크립트는
 * server-only 선언 때문에 이 배럴을 import 할 수 없어 구현부를 직접 쓴다.
 * 그래서 3차 방어선인 `scripts/check-bundle-secrets.ts` 가 실제 빌드
 * 산출물에서 시크릿 값을 다시 훑는다.
 */

import "server-only";

export {
  getAccessToken,
  setTokenStore,
  tossGet,
  type TokenStore,
} from "./core";

export {
  MARKET_SEGMENTS,
  SYMBOLS_PER_CALL,
  CANDLES_PER_CALL,
  fetchListedStocks,
  fetchStockInfos,
  fetchCandlePage,
  fetchPrices,
  fetchWarnings,
  marketOf,
  type MarketSegment,
  type ListedStock,
  type StockInfo,
  type RawPrice,
} from "./endpoints";

export { TARGET_CANDLES, fetchCandles } from "./candles";

export {
  MARKET_TIMEZONE,
  MARKET_OF_SEGMENT,
  tradeDateOf,
  todayInMarket,
  inferMarket,
  isFormingBar,
} from "./trading-day";

export { TossApiError, mapTossError, toLogFields, TOSS_TIMEOUT_MS } from "./errors";
