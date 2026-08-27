/**
 * 검색 결과용 경량 시세 (PRD §5.2)
 *
 * ── 계약 확장 E-03 ────────────────────────────────────────────────
 *
 * §6.4 는 `/api/stock`·`/api/watchlist` 만 정의한다. 그런데 검색 결과
 * 리스트는 종목명·티커·시장 배지 옆에 **현재가와 등락률만** 필요하고,
 * §5.2 는 그것이 "결과 수에 관계없이 호출 1회"로 끝난다고 못박았다.
 *
 * `/api/watchlist` 를 그대로 쓰면 그 약속이 깨진다. 관심종목은 위치·추세를
 * 함께 주므로 종목마다 250봉이 필요하고, 캐시에 없는 종목이 20개면 토스
 * 차트 호출이 40회 나간다. 검색은 **훑어보는 화면**이라 그럴 이유가 없다.
 *
 * 그래서 이 서비스는 규칙이 하나 더 있다:
 *   🔑 **캔들을 절대 새로 받지 않는다.** 캐시에 있으면 등락률을 계산하고,
 *      없으면 `changeRate: null` 로 둔다. 화면은 현재가만 보여주면 된다.
 *
 * 토스 호출은 `/prices` 다건 1회. §5.2 의 약속이 문자 그대로 성립한다.
 */

import type { Database } from "better-sqlite3";

import { getCandles, getStock } from "../db/repo";
import { TossApiError, logLine, toLogFields } from "../toss/errors";
import { isFormingBar } from "../toss/trading-day";
import type { Currency, Market } from "../types";
import { getPrices } from "./stock";

export interface Quote {
  symbol: string;
  name: string;
  market: Market;
  currency: Currency;
  price: number | null;
  /** 캐시에 전일 종가가 없으면 null. 화면은 등락률 자리를 비워둔다 */
  changeRate: number | null;
  changeAmount: number | null;
}

/**
 * 전일 종가를 **캐시에서만** 찾는다.
 *
 * 최신 봉이 진행 중인 당일 봉이면 그 앞 봉이 전일 종가다 (§7.1 실측 ④).
 * 이 판정을 빼면 등락률이 하루씩 밀린다.
 */
function previousClose(db: Database, symbol: string, market: Market): number | null {
  // 등락률에 필요한 건 최근 2봉뿐이다. 250봉을 읽을 이유가 없다.
  const recent = getCandles(db, symbol, 2);
  if (recent.length === 0) return null;

  const latest = recent.at(-1)!;
  if (isFormingBar(latest.date, market)) {
    return recent.at(-2)?.close ?? null;
  }
  return latest.close;
}

/**
 * 심볼 목록 → 시세.
 *
 * 마스터에 없는 심볼은 조용히 버린다. 검색 결과는 우리 인덱스에서 나온
 * 것이므로 여기 걸릴 일이 없고, 걸린다면 인덱스가 낡은 것이다.
 */
export async function getQuotes(
  db: Database | null,
  symbols: readonly string[],
): Promise<Quote[]> {
  if (symbols.length === 0) return [];

  const metas = new Map<string, { name: string; market: Market; currency: Currency }>();

  if (db !== null) {
    for (const symbol of symbols) {
      const row = getStock(db, symbol);
      if (row === null) continue;
      metas.set(symbol, {
        name: row.name_ko ?? row.name_en ?? row.symbol,
        market: row.market,
        currency: row.currency === "USD" ? "USD" : "KRW",
      });
    }
  }

  const known = [...metas.keys()];
  if (known.length === 0) return [];

  // 여기가 유일한 토스 호출이다 (§5.2)
  //
  // 시세를 못 받아도 검색 결과 자체는 살려서 내려간다 — 종목을 고르는 데는
  // 이름과 티커면 충분하고, 가격 칸은 화면이 "—" 로 비운다.
  //
  // 다만 **조용히 삼키지는 않는다.** 403 ip-not-allowed 처럼 배포/네트워크
  // 환경이 바뀌면 바로 터지는 오류가 여기로 들어오는데(§12.4), 로그가 없으면
  // "전 종목 가격이 비어 보이는" 증상만 남고 원인이 사라진다.
  const prices = await getPrices(known).catch((err: unknown) => {
    if (err instanceof TossApiError) {
      console.error(`[quotes] ${logLine(err)}`, toLogFields(err));
    } else {
      console.error("[quotes] 시세 조회 실패:", err);
    }
    return new Map<string, { price: number; asOf: string }>();
  });

  return known.map((symbol): Quote => {
    const meta = metas.get(symbol)!;
    const hit = prices.get(symbol);
    const current = hit?.price ?? null;

    const base = db !== null ? previousClose(db, symbol, meta.market) : null;
    const changeAmount = current !== null && base !== null ? current - base : null;
    const changeRate =
      changeAmount !== null && base !== null && base !== 0 ? changeAmount / base : null;

    return {
      symbol,
      name: meta.name,
      market: meta.market,
      currency: meta.currency,
      price: current,
      changeRate,
      changeAmount,
    };
  });
}
