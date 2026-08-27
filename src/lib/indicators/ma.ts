/**
 * 이동평균 — SMA (PRD §7.4)
 *
 *   MA_n[t] = ( Σ_{i=0}^{n-1} Close[t-i] ) / n
 *
 * 단순이동평균이다. EMA 가 아니다.
 *
 * KR·US 모두 같은 기간의 MA 쌍을 쓴다(단기 5/20, 중기 20/60, 장기 60/120 —
 * `types.ts` 의 `MA_PAIR_OF`). 미국 관습인 MA50/200 을 쓰지 않는 이유는
 * PRD §7.4 에 셋으로 정리되어 있고, 그중 결정적인 것은 두 번째다 —
 * 관심종목 화면에서 KR 과 US 의 기준이 달라지면 '동일 척도 비교'라는
 * 화면 5 의 전제 자체가 무너진다. 이 계약은 티어(단기/중기/장기)가
 * 늘어난 뒤에도 그대로 유지된다 — 어느 티어를 고르든 KR·US 는 같은 쌍을 쓴다.
 */

/**
 * 종가 배열(과거 → 최신 오름차순)에 대한 SMA 시계열.
 *
 * 반환 배열은 입력과 길이가 같고, 앞쪽 n-1 개는 계산 불가이므로 null 이다.
 * 인덱스를 입력과 일치시켜야 교차 판정에서 t / t-1 을 헷갈리지 않는다.
 *
 * @param closes 과거 → 최신 오름차순 종가
 * @param n 기간
 */
export function sma(closes: readonly number[], n: number): (number | null)[] {
  if (n <= 0) throw new Error(`sma: n 은 양수여야 한다 (받은 값: ${n})`);

  const out: (number | null)[] = new Array<number | null>(closes.length).fill(null);
  if (closes.length < n) return out;

  // 롤링 합. 종목당 250봉 × 2개 MA 이므로 O(N) 이면 충분하고도 남는다.
  let sum = 0;
  for (let i = 0; i < closes.length; i += 1) {
    sum += closes[i]!;
    if (i >= n) sum -= closes[i - n]!;
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

/**
 * 장중이면 최신 봉의 종가를 현재가로 대체한 종가 배열을 만든다 (§7.4).
 *
 * 장중에는 오늘 봉의 close 가 아직 확정 전이므로, 현재가를 종가로 간주해야
 * MA 가 "지금 시점"을 반영한다. 장 마감 후에는 그대로 둔다.
 *
 * @param closes 과거 → 최신 오름차순 종가 (마지막 원소 = 오늘 봉)
 * @param current 현재가
 * @param isRealtime 장중 여부. false 면 입력을 그대로 돌려준다
 */
export function withLiveClose(
  closes: readonly number[],
  current: number,
  isRealtime: boolean,
): number[] {
  const copy = [...closes];
  if (isRealtime && copy.length > 0) {
    copy[copy.length - 1] = current;
  }
  return copy;
}

/** 이격률 = (maShort - maLong) / maLong. 부호가 있으므로 정/역배열 판정에도 쓴다 */
export function gapRatio(maShort: number, maLong: number): number {
  if (maLong === 0) throw new Error("gapRatio: maLong 이 0 이다");
  return (maShort - maLong) / maLong;
}
