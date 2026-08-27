/**
 * 위치 계산 — 퍼센타일 (PRD §7.2)
 *
 * Min-Max 가 아니라 midrank 퍼센타일을 쓴다. 근거는 PRD §7.2 표에 있고,
 * 요약하면 세 가지다.
 *
 *   1. 기간 중 하루의 급등이 이후 전체 기간의 위치를 고착시키지 않는다
 *   2. 전 종가가 동일해도 division by zero 가 없다 (50.0% 로 수렴)
 *   3. 화면 문구가 해석("범위의 32% 지점")이 아니라 사실("33%의 날보다 높음")이 된다
 *      → PP-02 의 근거가 이 선택 위에 서 있다
 */

/** 부동소수 비교 상대오차 (PRD §7.1) */
export const EPSILON = 1e-9;

/** a 와 b 를 상대오차 EPSILON 내에서 같다고 볼 수 있는가 */
export function nearlyEqual(a: number, b: number): boolean {
  if (a === b) return true;
  const scale = Math.max(Math.abs(a), Math.abs(b));
  return Math.abs(a - b) <= EPSILON * Math.max(1, scale);
}

/**
 * midrank 퍼센타일.
 *
 *   below = |{ i : P[i] < C }|
 *   equal = |{ i : P[i] == C }|
 *   percentile = (below + 0.5 × equal) / N × 100
 *
 * `closes` 는 **분포를 이루는 직전 N거래일의 종가**이며 당일은 포함하지 않는다 (§7.1).
 * 당일을 분포에 넣으면 현재가가 자기 자신과 비교되어 표본이 오염된다.
 *
 * @param closes 직전 N거래일의 수정주가 종가
 * @param current 현재가 (실시간 또는 최종 체결가)
 * @returns 0~100
 */
export function midrankPercentile(closes: readonly number[], current: number): number {
  const n = closes.length;
  if (n === 0) {
    throw new Error("midrankPercentile: 종가 배열이 비어 있다");
  }

  let below = 0;
  let equal = 0;
  for (const c of closes) {
    if (nearlyEqual(c, current)) equal += 1;
    else if (c < current) below += 1;
  }

  return ((below + 0.5 * equal) / n) * 100;
}

/** 기간 내 모든 종가가 동일한가 (§12.1 — 위치 해석이 무의미한 경우) */
export function isFlat(closes: readonly number[]): boolean {
  if (closes.length <= 1) return true;
  const first = closes[0]!;
  return closes.every((c) => nearlyEqual(c, first));
}
