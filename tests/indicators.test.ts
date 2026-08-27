/**
 * 지표 엔진 단위 테스트 (PRD §15 1-2 검증 기준)
 *
 * "알려진 종목 5개에 대해 손계산 값과 일치. 엣지 케이스(전 종가 동일, 봉 부족)
 *  테스트 통과" — PRD가 지정한 게이트다.
 *
 * 여기 나오는 기대값은 전부 PRD 본문에서 직접 가져오거나 손으로 계산한 것이며,
 * 구현을 실행해서 얻은 값이 아니다. 그래야 테스트가 구현의 거울이 되지 않는다.
 */

import { describe, expect, it } from "vitest";

import { isFlat, midrankPercentile, nearlyEqual } from "../src/lib/indicators/percentile";
import {
  HYSTERESIS_MARGIN,
  ZONE_RANGES,
  zoneOf,
  zoneWithHysteresis,
} from "../src/lib/indicators/zone";
import { gapRatio, sma, withLiveClose } from "../src/lib/indicators/ma";
import { MIN_GAP_RATIO, detectCross } from "../src/lib/indicators/cross";
import { resolvePeriod, canComputeTrend } from "../src/lib/indicators/requirements";
import { analyzePosition, analyzeTrend } from "../src/lib/indicators/analyze";
import { buildExplanations, MAX_SENTENCES } from "../src/lib/templates";
import type { Candle } from "../src/lib/types";

// ── 테스트 픽스처 헬퍼 ─────────────────────────────────────────────────

/** 종가 배열로부터 캔들 배열을 만든다. 날짜는 거래일 순번으로만 쓴다 */
function candlesFrom(closes: number[], volumes?: number[]): Candle[] {
  return closes.map((close, i) => ({
    date: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`,
    open: close,
    high: close,
    low: close,
    close,
    volume: volumes?.[i] ?? 1_000_000,
  }));
}

/** 날짜가 고유해야 하는 테스트용 — 순번을 날짜로 환산 */
function candlesSeq(closes: number[], volumes?: number[]): Candle[] {
  const base = Date.UTC(2025, 0, 1);
  return closes.map((close, i) => ({
    date: new Date(base + i * 86_400_000).toISOString().slice(0, 10),
    open: close,
    high: close,
    low: close,
    close,
    volume: volumes?.[i] ?? 1_000_000,
  }));
}

// ══════════════════════════════════════════════════════════════════════
// §7.2 퍼센타일 (midrank)
// ══════════════════════════════════════════════════════════════════════

describe("§7.2 midrank 퍼센타일", () => {
  it("PRD 계산 예시를 재현한다 — 삼성전자 N=120, 현재가 74,500원", () => {
    // PRD §7.2: 미만 38일, 같은 날 2일 → (38 + 0.5×2)/120 × 100 = 32.5%
    const closes = [
      ...Array<number>(38).fill(70_000), // 74,500 미만
      ...Array<number>(2).fill(74_500), // 동일
      ...Array<number>(80).fill(80_000), // 초과
    ];
    expect(closes).toHaveLength(120);

    const p = midrankPercentile(closes, 74_500);
    expect(p).toBeCloseTo(32.5, 10);
    expect(Math.round(p)).toBe(33); // 문구는 "약 33%"

    // ⚠️ PRD 내부 모순 — 확인 후 §7.3 경계값 표를 진실로 채택했다.
    //
    //    §7.3 (규범):  KNEE = 10 ≤ p < 30,  WAIST = 30 ≤ p < 55
    //    §7.2:578      "32.5% → 구간: KNEE (무릎)"   ← 표와 충돌
    //    §5.3:253      화면 예시 "무릎 · 32%"         ← 표와 충돌
    //    §1.5:67       PP-05 배경 "무릎 31%"          ← 표와 충돌
    //
    //    경계값 표는 F-POS-02 와 DB 스키마(body_zone)가 함께 참조하는 규범이고,
    //    예시 3곳은 산문이다. 표를 따르고 PRD 예시 문구를 수정했다.
    //    §14.3 이 "실제 분포 확인 후 경계값 재조정"을 예고하므로 추후 튜닝 대상이다.
    expect(zoneOf(p)).toBe("WAIST");
  });

  it("동점에 0.5 가중을 준다 — below/N 도 (below+equal)/N 도 아니다", () => {
    // 10개 중 미만 4, 동일 4, 초과 2 → (4 + 2)/10 = 60%
    const closes = [1, 1, 1, 1, 5, 5, 5, 5, 9, 9];
    expect(midrankPercentile(closes, 5)).toBeCloseTo(60, 10);
    // 한쪽으로 치우친 두 대안과 실제로 다른 값이어야 한다
    expect(midrankPercentile(closes, 5)).not.toBeCloseTo(40, 1); // below/N
    expect(midrankPercentile(closes, 5)).not.toBeCloseTo(80, 1); // (below+equal)/N
  });

  it("전 종가가 동일하면 division by zero 없이 50.0% 로 수렴한다 (§12.1)", () => {
    const closes = Array<number>(120).fill(1_000);
    const p = midrankPercentile(closes, 1_000);
    expect(p).toBe(50);
    expect(Number.isNaN(p)).toBe(false);
    expect(isFlat(closes)).toBe(true);
  });

  it("현재가가 전 구간 최소/최대를 벗어나면 0% / 100% 다", () => {
    const closes = [10, 20, 30, 40, 50];
    expect(midrankPercentile(closes, 5)).toBe(0);
    expect(midrankPercentile(closes, 100)).toBe(100);
  });

  it("Min-Max 와 달리 하루짜리 급등에 고착되지 않는다 (§7.2 설계 근거)", () => {
    // 119일은 100 근처, 하루만 300으로 급등. 현재가 105.
    const closes = [...Array<number>(119).fill(100), 300];
    const p = midrankPercentile(closes, 105);

    // Min-Max 라면 (105-100)/(300-100) = 2.5% 로 바닥에 고착된다.
    const minMax = ((105 - 100) / (300 - 100)) * 100;
    expect(minMax).toBeCloseTo(2.5, 5);

    // 퍼센타일은 그 하루를 표본 1개로만 취급하므로 99% 를 넘는다.
    expect(p).toBeGreaterThan(99);
  });

  it("부동소수 상대오차 1e-9 내에서 동점으로 본다 (§7.1)", () => {
    expect(nearlyEqual(0.1 + 0.2, 0.3)).toBe(true);
    expect(nearlyEqual(1_000, 1_000.1)).toBe(false);
  });

  it("빈 배열은 던진다 — 조용히 0을 반환하지 않는다", () => {
    expect(() => midrankPercentile([], 100)).toThrow();
  });
});

// ══════════════════════════════════════════════════════════════════════
// §7.3 구간 매핑 + 히스테리시스
// ══════════════════════════════════════════════════════════════════════

describe("§7.3 6구간 매핑", () => {
  it("PRD 경계값 표와 정확히 일치한다", () => {
    expect(zoneOf(0)).toBe("FOOT");
    expect(zoneOf(9.99)).toBe("FOOT");
    expect(zoneOf(10)).toBe("KNEE");
    expect(zoneOf(29.99)).toBe("KNEE");
    expect(zoneOf(30)).toBe("WAIST");
    expect(zoneOf(54.99)).toBe("WAIST");
    expect(zoneOf(55)).toBe("CHEST");
    expect(zoneOf(71.99)).toBe("CHEST");
    expect(zoneOf(72)).toBe("SHOULDER");
    expect(zoneOf(84.99)).toBe("SHOULDER");
    expect(zoneOf(85)).toBe("HEAD");
    expect(zoneOf(100)).toBe("HEAD"); // HEAD 만 상한이 닫혀 있다
  });

  it("구간이 빈틈도 겹침도 없이 0~100 을 덮는다", () => {
    expect(ZONE_RANGES[0]!.min).toBe(0);
    expect(ZONE_RANGES.at(-1)!.max).toBe(100);
    for (let i = 1; i < ZONE_RANGES.length; i += 1) {
      expect(ZONE_RANGES[i]!.min).toBe(ZONE_RANGES[i - 1]!.max);
    }
  });
});

describe("§7.3 경계 히스테리시스 (F-POS-05)", () => {
  it("29.5% ↔ 30.5% 를 오가도 라벨이 흔들리지 않는다 (PRD 명시 시나리오)", () => {
    // 무릎(10~30)에서 출발
    let zone = zoneWithHysteresis(29.5, null);
    expect(zone).toBe("KNEE");

    // 30.5 는 raw 로는 허리지만, 경계 30 에서 2.0%p 이내이므로 무릎 유지
    zone = zoneWithHysteresis(30.5, zone);
    expect(zone).toBe("KNEE");

    zone = zoneWithHysteresis(29.5, zone);
    expect(zone).toBe("KNEE");

    zone = zoneWithHysteresis(30.5, zone);
    expect(zone).toBe("KNEE");
  });

  it("경계에서 2.0%p 를 넘기면 실제로 전환된다", () => {
    const zone = zoneWithHysteresis(32.1, "KNEE"); // 30 + 2.0 = 32.0 초과
    expect(zone).toBe("WAIST");
  });

  it("정확히 margin 만큼 벗어난 지점은 아직 유지한다", () => {
    expect(zoneWithHysteresis(30 + HYSTERESIS_MARGIN, "KNEE")).toBe("KNEE");
  });

  it("최초 표시(이전 구간 없음)에는 raw 매핑을 쓴다", () => {
    expect(zoneWithHysteresis(30.5, null)).toBe("WAIST");
  });

  it("표시되는 퍼센타일 수치 자체는 히스테리시스와 무관하다 (PP-03)", () => {
    // 히스테리시스는 zone 만 반환한다. 퍼센타일을 만지는 API 가 아예 없다.
    const zone = zoneWithHysteresis(30.5, "KNEE");
    expect(zone).toBe("KNEE");
    expect(midrankPercentile([1, 2, 3, 4], 3.5)).toBe(75); // 수치는 언제나 실제 값
  });

  it("FOOT 하단과 HEAD 상단은 벽이므로 확장하지 않는다", () => {
    expect(zoneWithHysteresis(0, "FOOT")).toBe("FOOT");
    expect(zoneWithHysteresis(100, "HEAD")).toBe("HEAD");
  });
});

// ══════════════════════════════════════════════════════════════════════
// §7.4 이동평균
// ══════════════════════════════════════════════════════════════════════

describe("§7.4 SMA", () => {
  it("앞쪽 n-1 개는 null 이고 인덱스가 입력과 일치한다", () => {
    const out = sma([1, 2, 3, 4, 5], 3);
    expect(out).toHaveLength(5);
    expect(out[0]).toBeNull();
    expect(out[1]).toBeNull();
    expect(out[2]).toBe(2); // (1+2+3)/3
    expect(out[3]).toBe(3); // (2+3+4)/3
    expect(out[4]).toBe(4); // (3+4+5)/3
  });

  it("봉이 n 보다 적으면 전부 null 이다", () => {
    expect(sma([1, 2], 5).every((v) => v === null)).toBe(true);
  });

  it("EMA 가 아니라 SMA 다 — 가중치가 균등하다", () => {
    // 급등 직후: SMA 라면 (10+10+100)/3 = 40. EMA 라면 훨씬 100 쪽으로 쏠린다.
    expect(sma([10, 10, 100], 3)[2]).toBe(40);
  });

  it("장중이면 최신 봉 종가를 현재가로 대체한다", () => {
    expect(withLiveClose([10, 20, 30], 99, true)).toEqual([10, 20, 99]);
    expect(withLiveClose([10, 20, 30], 99, false)).toEqual([10, 20, 30]);
  });

  it("이격률은 부호를 유지한다", () => {
    expect(gapRatio(110, 100)).toBeCloseTo(0.1, 10);
    expect(gapRatio(90, 100)).toBeCloseTo(-0.1, 10);
  });
});

// ══════════════════════════════════════════════════════════════════════
// §7.5 교차 판정 + 위양성 필터
// ══════════════════════════════════════════════════════════════════════

describe("§7.5 교차 판정", () => {
  /** MA 시계열을 직접 주입해 교차 상황을 만든다 */
  function crossFixture(
    shortVals: (number | null)[],
    longVals: (number | null)[],
    volumes?: number[],
  ): Parameters<typeof detectCross>[0] {
    const dates = shortVals.map((_, i) =>
      new Date(Date.UTC(2025, 0, 1) + i * 86_400_000).toISOString().slice(0, 10),
    );
    return {
      dates,
      maShort: shortVals,
      maLong: longVals,
      volumes: volumes ?? shortVals.map(() => 1_000_000),
    };
  }

  it("상향 교차를 잡고 경과일을 센다", () => {
    // 마지막 날 short 가 long 을 확실히 넘어선다 (이격 2%)
    const short = [98, 99, 102];
    const long = [100, 100, 100];
    const cross = detectCross(crossFixture(short, long));

    expect(cross).not.toBeNull();
    expect(cross!.type).toBe("GOLDEN");
    expect(cross!.daysAgo).toBe(0);
  });

  it("하향 교차를 잡는다", () => {
    const cross = detectCross(crossFixture([102, 101, 98], [100, 100, 100]));
    expect(cross!.type).toBe("DEAD");
  });

  it("이격이 0.5% 미만이면 whipsaw 로 보고 기각한다 (2단계)", () => {
    // 100 → 100.3 은 0.3% 이격. MIN_GAP_RATIO 미달.
    const cross = detectCross(crossFixture([99, 99.5, 100.3], [100, 100, 100]));
    expect(cross).toBeNull();
    expect(0.003).toBeLessThan(MIN_GAP_RATIO);
  });

  it("20거래일보다 오래된 교차는 버린다 (4단계)", () => {
    // index 1 에서 교차한 뒤 22일간 정배열 유지 → daysAgo = 22
    const short = [98, 105, ...Array<number>(22).fill(110)];
    const long = Array<number>(24).fill(100);
    const cross = detectCross(crossFixture(short, long));
    expect(cross).toBeNull();
  });

  it("20거래일 이내 교차는 유지한다 (경계)", () => {
    // index 1 에서 교차, 이후 19일 → daysAgo = 19
    const short = [98, 105, ...Array<number>(19).fill(110)];
    const long = Array<number>(21).fill(100);
    const cross = detectCross(crossFixture(short, long));
    expect(cross).not.toBeNull();
    expect(cross!.daysAgo).toBe(19);
  });

  it("가장 최근 교차 1건만 채택한다", () => {
    // 상향(idx 1) 후 하향(idx 3). 최신인 하향이 나와야 한다.
    const short = [98, 105, 106, 94];
    const long = [100, 100, 100, 100];
    const cross = detectCross(crossFixture(short, long));
    expect(cross!.type).toBe("DEAD");
    expect(cross!.daysAgo).toBe(0);
  });

  it("교차가 없으면 null 이다 — 화면 3은 배지 영역을 숨긴다 (§5.4)", () => {
    const flat = detectCross(crossFixture([110, 111, 112], [100, 100, 100]));
    expect(flat).toBeNull();
  });

  it("거래량 미확인은 교차를 막지 않는다 — 필터가 아니라 표시용이다 (3단계)", () => {
    // 교차일 거래량이 직전 평균보다 확연히 적다
    const short = [98, 99, 102];
    const long = [100, 100, 100];
    const cross = detectCross(crossFixture(short, long, [1_000_000, 1_000_000, 1]));

    expect(cross).not.toBeNull(); // 교차 자체는 살아 있다
    expect(cross!.volumeConfirmed).toBe(false);
  });

  it("MA60 이 아직 잡히지 않는 구간에서는 null 이다", () => {
    const cross = detectCross(crossFixture([null, null, 102], [null, null, 100]));
    expect(cross).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════
// §7.7 최소 데이터 요구량 + 자동 강등
// ══════════════════════════════════════════════════════════════════════

describe("§7.7 자동 강등", () => {
  it("장기(120) 요청 · 80봉 미만이면 중기(60) 로 강등한다", () => {
    const r = resolvePeriod(120, 50);
    expect(r.period).toBe(60);
    expect(r.downgraded).toBe(true);
    expect(r.unavailable).toBe(false);
  });

  it("중기(60) 요청 · 40봉 미만이면 단기(20) 로 강등한다", () => {
    const r = resolvePeriod(60, 25);
    expect(r.period).toBe(20);
    expect(r.downgraded).toBe(true);
  });

  it("단기(20) 요청 · 14봉 미만이면 계산 불가다", () => {
    const r = resolvePeriod(20, 13);
    expect(r.unavailable).toBe(true);
  });

  it("봉이 충분하면 강등하지 않는다", () => {
    const r = resolvePeriod(120, 120);
    expect(r.period).toBe(120);
    expect(r.downgraded).toBe(false);
  });

  it("요청보다 긴 기간으로 올리지는 않는다 — 사용자가 단기를 골랐으면 단기다", () => {
    const r = resolvePeriod(20, 120);
    expect(r.period).toBe(20);
    expect(r.downgraded).toBe(false);
  });

  it("각 티어는 그 티어의 장기 MA+1 봉이 있어야 추세를 계산한다", () => {
    // 단기(MA5 vs MA20): MA20 이 기준
    expect(canComputeTrend(20, 20)).toBe(false);
    expect(canComputeTrend(21, 20)).toBe(true);
    // 중기(MA20 vs MA60): MA60 이 기준
    expect(canComputeTrend(60, 60)).toBe(false);
    expect(canComputeTrend(61, 60)).toBe(true);
    // 장기(MA60 vs MA120): MA120 이 기준
    expect(canComputeTrend(120, 120)).toBe(false);
    expect(canComputeTrend(121, 120)).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 오케스트레이션
// ══════════════════════════════════════════════════════════════════════

describe("analyzePosition", () => {
  it("분포에 당일을 포함하지 않는다 (§7.1)", () => {
    // 최신 봉만 999. 나머지 100개는 전부 10.
    const candles = candlesSeq([...Array<number>(100).fill(10), 999]);
    const pos = analyzePosition({ candles, current: 999, isRealtime: false, halted: false }, 60);

    // 당일을 뺀 60일치는 전부 10 이고 현재가 999 는 그 전부보다 높다 → 100%
    expect(pos.percentile).toBe(100);
    expect(pos.dataPoints).toBe(60);
  });

  it("거래정지면 계산 자체를 수행하지 않는다 (§12.1)", () => {
    const candles = candlesSeq(Array<number>(200).fill(100));
    const pos = analyzePosition({ candles, current: 100, isRealtime: false, halted: true }, 120);

    expect(pos.available).toBe(false);
    expect(pos.reason).toBe("HALTED");
    expect(pos.percentile).toBeNull();
    expect(pos.zone).toBeNull();
  });

  it("봉이 모자라면 강등하고 그 사실을 표시한다 (PP-03)", () => {
    const candles = candlesSeq(Array<number>(51).fill(100)); // 당일 제외 50봉
    const pos = analyzePosition({ candles, current: 100, isRealtime: false, halted: false }, 120);

    expect(pos.available).toBe(true);
    expect(pos.periodDays).toBe(60);
    expect(pos.requestedPeriodDays).toBe(120);
    expect(pos.downgraded).toBe(true); // 조용히 바꾸지 않는다
  });

  it("전 종가 동일 시 50% + flatPrices 플래그", () => {
    const candles = candlesSeq(Array<number>(150).fill(1_000));
    const pos = analyzePosition({ candles, current: 1_000, isRealtime: false, halted: false }, 120);

    expect(pos.percentile).toBe(50);
    expect(pos.flatPrices).toBe(true);
    expect(pos.zone).toBe("WAIST");
  });

  it("최고가·최저가는 고가/저가 기준이며 퍼센타일과 별개다", () => {
    const candles: Candle[] = candlesSeq(Array<number>(101).fill(100));
    candles[50] = { ...candles[50]!, high: 500, low: 10 };

    const pos = analyzePosition({ candles, current: 100, isRealtime: false, halted: false }, 60);
    // 60일 창(인덱스 40~99)에 50번이 포함된다
    expect(pos.periodHigh).toBe(500);
    expect(pos.periodLow).toBe(10);
    // 종가는 전부 100 이므로 퍼센타일은 여전히 50 이다 — 서로 다른 것을 잰다
    expect(pos.percentile).toBe(50);
  });
});

describe("analyzeTrend", () => {
  it("중기(MA20 vs MA60): 61봉 미만이면 INSUFFICIENT_DATA 다", () => {
    const trend = analyzeTrend(
      {
        candles: candlesSeq(Array<number>(60).fill(100)),
        current: 100,
        isRealtime: false,
        halted: false,
      },
      60,
    );
    expect(trend.available).toBe(false);
    expect(trend.reason).toBe("INSUFFICIENT_DATA");
    // 계산 불가여도 이 블록이 어느 쌍을 다루는지는 항상 알 수 있다
    expect(trend.maShortPeriod).toBe(20);
    expect(trend.maLongPeriod).toBe(60);
  });

  it("배열 상태는 available 이면 항상 값이 있다 (F-TREND-02)", () => {
    // 우상향 추세 → 정배열
    const rising = Array.from({ length: 100 }, (_, i) => 100 + i);
    const trend = analyzeTrend(
      { candles: candlesSeq(rising), current: 199, isRealtime: false, halted: false },
      60,
    );
    expect(trend.available).toBe(true);
    expect(trend.alignment).toBe("UP");
    expect(trend.maShort).not.toBeNull();
    expect(trend.gapRatio).toBeGreaterThan(0);
  });

  it("우하향이면 역배열이다", () => {
    const falling = Array.from({ length: 100 }, (_, i) => 200 - i);
    const trend = analyzeTrend(
      { candles: candlesSeq(falling), current: 101, isRealtime: false, halted: false },
      60,
    );
    expect(trend.alignment).toBe("DOWN");
    expect(trend.gapRatio).toBeLessThan(0);
  });

  it.each([
    { tier: 20 as const, short: 5, long: 20 },
    { tier: 60 as const, short: 20, long: 60 },
    { tier: 120 as const, short: 60, long: 120 },
  ])("$tier(단기/중기/장기): MA$short vs MA$long 을 비교한다", ({ tier, short, long }) => {
    const rising = Array.from({ length: 300 }, (_, i) => 100 + i);
    const closes = candlesSeq(rising).map((c) => c.close);
    const trend = analyzeTrend(
      { candles: candlesSeq(rising), current: 100 + 299, isRealtime: false, halted: false },
      tier,
    );

    expect(trend.available).toBe(true);
    expect(trend.maShortPeriod).toBe(short);
    expect(trend.maLongPeriod).toBe(long);

    // 손계산: 마지막 short/long 개 종가의 평균
    const handShort = closes.slice(-short).reduce((a, b) => a + b, 0) / short;
    const handLong = closes.slice(-long).reduce((a, b) => a + b, 0) / long;
    expect(trend.maShort!).toBeCloseTo(handShort, 6);
    expect(trend.maLong!).toBeCloseTo(handLong, 6);
  });

  it("미니 차트 창 길이는 그 티어의 장기 MA 기간을 넘지 않는다 (§5.4-a)", () => {
    const rising = Array.from({ length: 400 }, (_, i) => 100 + i);
    const input = { candles: candlesSeq(rising), current: 499, isRealtime: false, halted: false };

    for (const { tier, long } of [
      { tier: 20 as const, long: 20 },
      { tier: 60 as const, long: 60 },
      { tier: 120 as const, long: 120 },
    ]) {
      const trend = analyzeTrend(input, tier);
      expect(trend.maSeries.length).toBeLessThanOrEqual(long);
      expect(trend.maSeries.length).toBeGreaterThan(0);
      // 창의 마지막 원소는 오늘의 maShort/maLong 과 일치해야 한다
      expect(trend.maSeries.at(-1)!.short).toBeCloseTo(trend.maShort!, 6);
      expect(trend.maSeries.at(-1)!.long).toBeCloseTo(trend.maLong!, 6);
    }
  });

  it("장기로 갈수록 창이 넓어진다 — 같은 데이터, 다른 티어", () => {
    const rising = Array.from({ length: 400 }, (_, i) => 100 + i);
    const input = { candles: candlesSeq(rising), current: 499, isRealtime: false, halted: false };

    const short = analyzeTrend(input, 20);
    const mid = analyzeTrend(input, 60);
    const long = analyzeTrend(input, 120);

    expect(short.maSeries.length).toBeLessThan(mid.maSeries.length);
    expect(mid.maSeries.length).toBeLessThan(long.maSeries.length);
  });

  it("보유 봉이 요청 기간보다 적으면 있는 만큼만 담는다", () => {
    // 150봉만 있는 종목: 중기(창 60) 는 요청한 만큼 꽉 채울 수 있지만,
    // 장기(창 120) 는 애초에 그만한 데이터가 없다 — 잘라내기가 아니라
    // 있는 만큼만 정직하게 담아야 한다 (PP-03 과 같은 정신).
    const rising = Array.from({ length: 150 }, (_, i) => 100 + i);
    const input = { candles: candlesSeq(rising), current: 249, isRealtime: false, halted: false };

    expect(analyzeTrend(input, 60).maSeries.length).toBe(60);
    expect(analyzeTrend(input, 120).maSeries.length).toBeLessThan(120);
  });
});

// ══════════════════════════════════════════════════════════════════════
// §7.6 템플릿 조립
// ══════════════════════════════════════════════════════════════════════

describe("§7.6 설명 문구", () => {
  const candles = candlesSeq(Array.from({ length: 200 }, (_, i) => 100 + i));
  const input = { candles, current: 299, isRealtime: false, halted: false } as const;

  it("위치 문장과 추세 문장이 분리된 배열로 나온다 (R-01 구조적 강제)", () => {
    const pos = analyzePosition(input, 120);
    const trend = analyzeTrend(input, 60);
    const ex = buildExplanations(pos, trend, "KRW");

    expect(Array.isArray(ex.position)).toBe(true);
    expect(Array.isArray(ex.trend)).toBe(true);
    // 두 배열이 한 문자열로 합쳐지는 경로가 존재하지 않는다
    expect(ex.position.join(" ")).not.toContain("이며");
  });

  it("총 4문장을 넘지 않는다 (R-03)", () => {
    const pos = analyzePosition(input, 120);
    const trend = analyzeTrend(input, 60);
    const ex = buildExplanations(pos, trend, "KRW");

    expect(ex.position.length + ex.trend.length).toBeLessThanOrEqual(MAX_SENTENCES);
  });

  it("잘라내도 필수 문장은 남는다", () => {
    const pos = analyzePosition(input, 120);
    const trend = analyzeTrend(input, 60);
    const ex = buildExplanations(pos, trend, "KRW");

    expect(ex.position[0]).toMatch(/최근 \d+거래일 중 약 \d+%의 날보다 높습니다\./);
    expect(ex.trend[0]).toMatch(/20일 평균 가격이 60일 평균 가격보다 (높|낮)습니다\./);
  });

  it("PRD 예시 문구를 그대로 만든다", () => {
    // §7.2 예시: 120거래일, 32.5% → "최근 120거래일 중 약 33%의 날보다 높습니다."
    const closes = [
      ...Array<number>(38).fill(70_000),
      ...Array<number>(2).fill(74_500),
      ...Array<number>(80).fill(80_000),
    ];
    const c = candlesSeq([...closes, 74_500]); // 마지막은 당일 봉(분포 제외)
    const pos = analyzePosition(
      { candles: c, current: 74_500, isRealtime: false, halted: false },
      120,
    );
    const ex = buildExplanations(
      pos,
      analyzeTrend({ candles: c, current: 74_500, isRealtime: false, halted: false }, 60),
      "KRW",
    );

    expect(ex.position[0]).toBe("최근 120거래일 중 약 33%의 날보다 높습니다.");
  });

  it("거래정지면 그 사실만 말한다", () => {
    const halted = { candles, current: 299, isRealtime: false, halted: true } as const;
    const pos = analyzePosition(halted, 120);
    const ex = buildExplanations(pos, analyzeTrend(halted, 60), "KRW");

    expect(ex.position).toEqual(["거래가 정지된 종목입니다."]);
    expect(ex.trend).toEqual([]); // 중복 안내하지 않는다
  });

  it("US 종목은 달러로 포맷한다 (R-04)", () => {
    const pos = analyzePosition(input, 120);
    const ex = buildExplanations(pos, analyzeTrend(input, 60), "USD");
    const highLow = ex.position.find((s) => s.includes("최고가"));
    if (highLow !== undefined) expect(highLow).toContain("$");
  });
});

// ══════════════════════════════════════════════════════════════════════
// PP-05 — 종합 판정을 만들지 않는지 구조적으로 확인
// ══════════════════════════════════════════════════════════════════════

describe("PP-05 종합 판정 금지", () => {
  it("어떤 입력에도 위치와 추세를 잇는 접속사가 등장하지 않는다", () => {
    const 접속사 = ["이며", "이고", "따라서", "그래서", "이므로", "면서"];

    // 정배열/역배열 × 여러 위치 조합을 훑는다
    for (const trendDir of [1, -1]) {
      for (const offset of [0, 50, 100, 150, 199]) {
        const closes = Array.from({ length: 200 }, (_, i) => 100 + trendDir * i);
        const c = candlesSeq(closes);
        const current = closes[offset]!;
        const inp = { candles: c, current, isRealtime: false, halted: false } as const;
        const ex = buildExplanations(analyzePosition(inp, 120), analyzeTrend(inp, 60), "KRW");

        for (const sentence of [...ex.position, ...ex.trend]) {
          for (const conj of 접속사) {
            expect(sentence).not.toContain(conj);
          }
        }
      }
    }
  });
});

// candlesFrom 은 날짜 중복 픽스처가 필요할 때를 위해 남겨둔다
void candlesFrom;
