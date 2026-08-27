/**
 * 일봉 캐시 오케스트레이션 (PRD §10.4 — 🔑 핵심 캐시)
 *
 * "250봉을 한 번 받아두면 60/120/250 세 기간의 퍼센타일과 MA20/60·교차가
 * 전부 이 하나의 배열에서 계산된다" 는 §8.2 의 주장이 실제로 성립하게
 * 만드는 곳이다. 기간 토글·탭 전환에 토스 호출이 0회인 근거가 여기 있다.
 *
 * 갱신 주기는 §10.4 가 "다음 장 마감까지" 로 정했다. 일봉은 하루에 한 번만
 * 확정되므로 그보다 자주 받을 이유가 없다.
 */

import type { Database } from "better-sqlite3";

import { candleCacheState, getCandles, purgeCandles, upsertCandles } from "../db/repo";
import { TARGET_CANDLES, fetchCandles } from "../toss/candles";
import { isFormingBar, todayInMarket } from "../toss/trading-day";
import type { Candle, Market } from "../types";

/** 같은 심볼에 동시 요청이 몰려도 토스 호출은 1회만 나간다 */
const inFlight = new Map<string, Promise<Candle[]>>();

/**
 * 캐시가 아직 쓸 만한가.
 *
 * 판정 기준은 "최신 봉이 시장 현지 오늘 것인가" 다.
 *   · 오늘 봉이 있다  → 장중이면 진행 중인 봉이라 값이 계속 변한다.
 *                       그래서 `staleAfterMs` 를 넘겼으면 다시 받는다.
 *   · 오늘 봉이 없다  → 아직 오늘 봉이 안 열렸거나 휴장. 다음 거래일
 *                       봉이 생길 때까지 받아봐야 같은 데이터다.
 *                       단 하루 이상 묵었으면 한 번 확인한다.
 */
export function isFresh(
  state: { latestTradeDate: string; fetchedAt: string },
  market: Market,
  count: number,
  staleAfterMs: number,
  now: Date,
): boolean {
  if (count < TARGET_CANDLES) {
    // 250봉을 못 채운 상태라면 신규 상장일 수도, 적재가 덜 된 것일 수도 있다.
    // 하루에 한 번은 다시 시도해 본다.
    const age = now.getTime() - Date.parse(state.fetchedAt);
    if (age > 24 * 60 * 60 * 1_000) return false;
  }

  const today = todayInMarket(market, now);
  const age = now.getTime() - Date.parse(state.fetchedAt);
  if (Number.isNaN(age)) return false;

  if (state.latestTradeDate === today) {
    // 진행 중인 봉을 들고 있다 — 짧게 잡는다
    return age < staleAfterMs;
  }

  // 여기부터는 "오늘 봉이 없다" = 마감된 봉만 들고 있다는 뜻이다.
  //
  // ⚠️ 그런데 마감된 봉이라고 해서 **확정된 값이라는 보장이 없다.**
  //    그 봉을 *그 봉의 거래일 당일에* 받아왔다면 미완성 상태로 담겼을 수
  //    있다 (§7.1 실측 ④). 그때의 종가는 그 시점의 현재가일 뿐이다.
  //
  //    실제로 겪은 사고: 005930 의 08-27 봉을 15:19(마감 15:30 전)에 받아
  //    종가 265,000 으로 저장했는데 확정 종가는 267,000 이었다. 날이 바뀌자
  //    `isFormingBar` 가 false 가 되면서 이 장중 스냅샷이 조용히 확정 종가
  //    행세를 했고, 등락률·퍼센타일·MA 가 전부 그 위에서 계산됐다.
  //
  //    날짜만 보는 판정으로는 이 둘을 구별할 수 없다. **받아온 시각**을
  //    같이 봐야 한다.
  if (isFormingBar(state.latestTradeDate, market, new Date(state.fetchedAt))) return false;

  // 다음 거래일 봉이 생겼는지 하루 한 번 확인한다.
  return age < 24 * 60 * 60 * 1_000;
}

/**
 * 250봉을 돌려준다. 캐시에 있으면 토스를 부르지 않는다.
 *
 * @param staleAfterMs 진행 중인 당일 봉을 얼마나 들고 있을지. 기본 5분.
 *                     현재가는 별도로 30초마다 갱신되므로(§10.4) 봉 자체를
 *                     더 자주 받을 이유가 없다 — MA 는 현재가로 보정된다(§7.4).
 */
export async function getCachedCandles(
  db: Database | null,
  symbol: string,
  market: Market,
  staleAfterMs = 5 * 60 * 1_000,
  now: Date = new Date(),
): Promise<Candle[]> {
  // DB 가 없으면 캐시 없이 직접 호출한다 (§12.4 폴백)
  if (db === null) return fetchCandles(symbol, market, TARGET_CANDLES);

  const state = candleCacheState(db, symbol);
  if (state !== null) {
    const cached = getCandles(db, symbol, TARGET_CANDLES);
    if (isFresh(state, market, cached.length, staleAfterMs, now)) return cached;
  }

  const pending = inFlight.get(symbol);
  if (pending !== undefined) return pending;

  const promise = (async () => {
    const fresh = await fetchCandles(symbol, market, TARGET_CANDLES);
    if (fresh.length > 0) {
      detectSplitAndPurge(db, symbol, fresh);
      upsertCandles(db, symbol, fresh, now.toISOString());
    }
    return fresh;
  })()
    .catch((err: unknown) => {
      // 토스가 실패해도 캐시가 있으면 그걸 준다. 낡은 데이터가 무응답보다 낫다.
      const stale = getCandles(db, symbol, TARGET_CANDLES);
      if (stale.length > 0) return stale;
      throw err;
    })
    .finally(() => {
      inFlight.delete(symbol);
    });

  inFlight.set(symbol, promise);
  return promise;
}

/**
 * 액면분할 감지 (§12.2)
 *
 * 분할이 일어나면 과거 수정주가가 통째로 바뀐다. UPSERT 는 겹치는 거래일만
 * 덮어쓰므로, 캐시에 남아 있던 **분할 전 가격의 과거 구간**이 그대로 살아남아
 * 새 가격과 뒤섞인다. 퍼센타일이 조용히 틀리는 가장 위험한 경로다.
 *
 * 겹치는 거래일의 종가가 유의미하게 다르면 심볼 캐시를 통째로 버린다.
 * 수정주가는 소수점 반올림 때문에 미세하게 흔들릴 수 있어 1% 여유를 둔다.
 */
function detectSplitAndPurge(db: Database, symbol: string, fresh: readonly Candle[]): void {
  const cached = getCandles(db, symbol, TARGET_CANDLES);
  if (cached.length === 0) return;

  const freshByDate = new Map(fresh.map((c) => [c.date, c]));

  for (const old of cached) {
    const now = freshByDate.get(old.date);
    if (now === undefined || old.close === 0) continue;

    const drift = Math.abs(now.close - old.close) / old.close;
    if (drift > 0.01) {
      console.warn(
        `[candle-cache] ${symbol}: ${old.date} 종가가 ${old.close} → ${now.close} 로 바뀌었다. ` +
          "액면분할·수정주가 재계산으로 보고 캐시를 폐기한다 (§12.2).",
      );
      purgeCandles(db, symbol);
      return;
    }
  }
}

/** 테스트·배치용 */
export function __clearInFlight(): void {
  inFlight.clear();
}
