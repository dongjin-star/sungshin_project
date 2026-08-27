/**
 * 교차 판정 + 위양성 필터 (PRD §7.5)
 *
 * 4단계로 구성된다.
 *
 *   1단계 원시 교차 감지  — 최근 20거래일을 최신→과거로 훑어 가장 최근 1건만 채택
 *   2단계 이격 필터       — gapRatio < 0.5% 면 횡보 whipsaw 로 보고 기각
 *   3단계 거래량 확인     — 필터가 아니라 표시용. false 여도 교차는 표시한다
 *   4단계 유효기간        — 20거래일이 지난 교차는 '현재 상태'가 아니므로 버린다
 *
 * '확인 지연'(교차 후 N일 유지 시 확정)을 넣지 않은 이유는 PRD §7.5 말미에 있다.
 * 요약하면 "어제 교차했으나 아직 확정 전"이라는 중간 상태를 초보자에게 설명할
 * 방법이 없기 때문이다.
 */

import type { CrossInfo } from "../types";

/** 교차 탐지 범위 및 유효기간 (거래일) */
export const CROSS_LOOKBACK_DAYS = 20;
/** 이격 필터 임계값. 0.5% */
export const MIN_GAP_RATIO = 0.005;
/** 거래량 확인에 쓰는 평균 기간 */
export const VOLUME_AVG_DAYS = 20;

export interface CrossInput {
  /** 거래일 'YYYY-MM-DD', 과거 → 최신 오름차순 */
  dates: readonly string[];
  /** sma() 출력. dates 와 길이·인덱스가 일치해야 한다 */
  maShort: readonly (number | null)[];
  maLong: readonly (number | null)[];
  /** 거래량, dates 와 인덱스 일치 */
  volumes: readonly number[];
}

/**
 * 가장 최근 유효 교차를 찾는다. 없으면 null.
 *
 * null 을 반환하는 경우는 네 가지이며, 전부 정상 동작이다:
 *   · 최근 20거래일 내 교차 없음
 *   · 교차는 있었으나 이격이 0.5% 미만 (whipsaw)
 *   · 교차일이 20거래일보다 오래됨
 *   · MA 계산에 필요한 봉이 부족
 */
export function detectCross(input: CrossInput): CrossInfo | null {
  const { dates, maShort, maLong, volumes } = input;
  const last = dates.length - 1;
  if (last < 1) return null;

  // ── 1단계: 원시 교차 감지 (최신 → 과거) ────────────────────────────
  // t 는 교차가 '완성된' 날. t-1 과 t 사이에서 대소가 뒤집힌다.
  const oldest = Math.max(1, last - (CROSS_LOOKBACK_DAYS - 1));

  for (let t = last; t >= oldest; t -= 1) {
    const sPrev = maShort[t - 1];
    const lPrev = maLong[t - 1];
    const sNow = maShort[t];
    const lNow = maLong[t];

    // MA60 이 아직 안 잡히는 구간이면 더 과거로 갈 필요도 없다
    if (sPrev == null || lPrev == null || sNow == null || lNow == null) break;

    let type: "GOLDEN" | "DEAD" | null = null;
    if (sPrev <= lPrev && sNow > lNow) type = "GOLDEN";
    else if (sPrev >= lPrev && sNow < lNow) type = "DEAD";

    if (type === null) continue;

    // ── 2단계: 이격 필터 ──────────────────────────────────────────
    // 교차 직후 두 선이 거의 붙어 있으면 며칠 안에 되돌려지는 경우가 대부분이다.
    const gap = Math.abs(sNow - lNow) / lNow;
    if (gap < MIN_GAP_RATIO) return null;

    // ── 4단계: 유효기간 ───────────────────────────────────────────
    // "3개월 전 골든크로스"는 현재 상태가 아니다.
    const daysAgo = last - t;
    if (daysAgo > CROSS_LOOKBACK_DAYS) return null;

    // ── 3단계: 거래량 확인 (필터 아님, 표시용) ─────────────────────
    return {
      type,
      date: dates[t]!,
      daysAgo,
      volumeConfirmed: isVolumeConfirmed(volumes, t),
    };
  }

  return null;
}

/**
 * 교차일의 거래량이 직전 20거래일 평균 이상인가.
 *
 * false 여도 교차를 숨기지 않는다. "다만 그날의 거래량은 최근 평균보다
 * 적었습니다"라는 사실을 덧붙일 뿐이다 (§7.6-B). 이것도 사실 진술이지
 * 신뢰도 점수가 아니다.
 *
 * 거래량 0인 날도 평균 산출에 포함한다 (§12.1).
 */
export function isVolumeConfirmed(volumes: readonly number[], t: number): boolean {
  const start = Math.max(0, t - VOLUME_AVG_DAYS);
  const window = volumes.slice(start, t);
  if (window.length === 0) return false;

  const avg = window.reduce((a, b) => a + b, 0) / window.length;
  return volumes[t]! >= avg;
}
