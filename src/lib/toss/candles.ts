/**
 * 250봉 확보 시퀀스 (PRD §8.2)
 *
 * 250봉을 한 번 받아두면 60·120·250 세 기간의 퍼센타일과 MA20/60·교차가
 * 전부 이 하나의 배열에서 계산된다. 기간 토글 시 토스 호출은 0회다.
 *
 * 실측 확인 (2026-08-27, 005930):
 *   1회차 count=200 → 200봉, nextBefore="2025-11-03T00:00:00.000+09:00"
 *   2회차 count=50 &before=... → 50봉
 *   합계 250봉. §8.2 가 설계한 그대로 성립한다.
 */

import { CANDLES_PER_CALL, fetchCandlePage } from "./endpoints";
import type { Candle, Market } from "../types";

/** §7.7 이 요구하는 최대 기간. 이보다 더 받을 이유가 없다 */
export const TARGET_CANDLES = 250;

/**
 * 최신 `target` 봉을 **과거 → 최신 오름차순**으로 돌려준다.
 *
 * 지표 엔진(`analyze.ts`)이 오름차순 배열을 전제하므로 정렬을 여기서 끝낸다.
 * 토스는 최신순으로 내려준다.
 *
 * 신규 상장 등으로 1회차가 200봉 미만이면 2회차를 생략한다 — 더 과거가
 * 없다는 뜻이므로 호출해봐야 빈 배열이다 (§8.2).
 */
export async function fetchCandles(
  symbol: string,
  market: Market,
  target: number = TARGET_CANDLES,
): Promise<Candle[]> {
  const collected: Candle[] = [];
  let before: string | undefined;

  while (collected.length < target) {
    const remaining = target - collected.length;
    const page = await fetchCandlePage(
      symbol,
      market,
      Math.min(remaining, CANDLES_PER_CALL),
      before,
    );

    collected.push(...page.candles);

    // 더 받을 게 없다: 빈 페이지 · 커서 없음 · 페이지가 상한 미만(= 과거 소진)
    if (
      page.candles.length === 0 ||
      page.nextBefore === null ||
      page.candles.length < Math.min(remaining, CANDLES_PER_CALL)
    ) {
      break;
    }

    before = page.nextBefore;
  }

  return dedupeAscending(collected);
}

/**
 * 거래일 오름차순 정렬 + 중복 제거.
 *
 * 페이지 경계에서 같은 거래일이 양쪽에 걸칠 수 있다. 중복이 남으면
 * 퍼센타일 표본이 오염되고 MA 가 한 칸씩 밀린다. 나중 항목이 이긴다 —
 * 뒤 페이지일수록 과거이므로 값이 같지만, 굳이 순서를 정해둔다.
 */
function dedupeAscending(candles: readonly Candle[]): Candle[] {
  const byDate = new Map<string, Candle>();
  for (const c of candles) byDate.set(c.date, c);
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}
