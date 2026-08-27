/**
 * 최소 데이터 요구량 + 자동 강등 (PRD §7.7)
 *
 * 봉이 모자랄 때 조용히 기준을 바꾸면 PP-03(기준을 숨기지 않는다) 위반이다.
 * 그래서 강등은 반드시 `downgraded: true` 로 표시되어 화면에 사유가 뜬다.
 */

import { MA_PAIR_OF, type PeriodDays } from "../types";

/** §7.7 — 퍼센타일 계산에 필요한 최소 봉 수. 요청 기간의 약 2/3 이다 */
export const MIN_CANDLES_FOR_PERIOD: Record<PeriodDays, number> = {
  20: 14,
  60: 40,
  120: 80,
};

/**
 * §7.7 — 이 티어의 추세를 계산하는 데 필요한 최소 봉 수.
 * 그 티어의 장기 MA 가 잡혀야 배열 상태가 나온다.
 */
export function minCandlesForTrend(period: PeriodDays): number {
  return MA_PAIR_OF[period].long + 1;
}

export interface PeriodResolution {
  /** 실제로 쓸 기간 */
  period: PeriodDays;
  /** 요청된 기간 */
  requested: PeriodDays;
  /** 강등 발생 여부. true 면 UI가 반드시 사유를 안내한다 */
  downgraded: boolean;
  /** 어떤 기간으로도 계산할 수 없음 */
  unavailable: boolean;
}

/**
 * 보유 봉 수에 맞춰 기간을 강등한다 (§7.7).
 *
 *   장기(120) → (80봉 미만) → 중기(60) → (40봉 미만) → 단기(20) → (14봉 미만) → 계산 불가
 *
 * 요청보다 더 긴 기간으로 올리지는 않는다. 사용자가 단기를 골랐으면 단기다.
 */
export function resolvePeriod(requested: PeriodDays, dataPoints: number): PeriodResolution {
  // 요청 기간 이하의 후보만, 긴 것부터 시도한다
  const candidates: PeriodDays[] = ([120, 60, 20] as const).filter((p) => p <= requested);

  for (const period of candidates) {
    if (dataPoints >= MIN_CANDLES_FOR_PERIOD[period]) {
      return {
        period,
        requested,
        downgraded: period !== requested,
        unavailable: false,
      };
    }
  }

  return { period: requested, requested, downgraded: false, unavailable: true };
}

/** 이 티어의 추세(배열 상태·교차)를 계산할 수 있는가 */
export function canComputeTrend(dataPoints: number, period: PeriodDays): boolean {
  return dataPoints >= minCandlesForTrend(period);
}
