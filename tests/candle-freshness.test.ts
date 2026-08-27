/**
 * 일봉 캐시 신선도 판정 (PRD §10.4, §7.1 실측 ④)
 *
 * 이 테스트가 지키는 사실 하나: **"마감된 날짜의 봉"과 "확정된 종가"는
 * 같은 말이 아니다.** 장중에 받아온 봉은 날이 바뀌어도 미완성인 채로 남는다.
 */

import { describe, expect, it } from "vitest";

import { isFresh } from "../src/lib/service/candle-cache";

const FULL = 250;
const FIVE_MIN = 5 * 60 * 1_000;

/** KST 기준 시각을 Date 로. 08-27 은 목요일(거래일)이다 */
function kst(iso: string): Date {
  return new Date(`${iso}+09:00`);
}

describe("isFresh — 진행 중인 당일 봉", () => {
  it("당일 봉을 방금 받았으면 신선하다", () => {
    const state = { latestTradeDate: "2026-08-27", fetchedAt: kst("2026-08-27T14:00:00").toISOString() };
    expect(isFresh(state, "KR", FULL, FIVE_MIN, kst("2026-08-27T14:02:00"))).toBe(true);
  });

  it("당일 봉이 5분을 넘겼으면 다시 받는다", () => {
    const state = { latestTradeDate: "2026-08-27", fetchedAt: kst("2026-08-27T14:00:00").toISOString() };
    expect(isFresh(state, "KR", FULL, FIVE_MIN, kst("2026-08-27T14:20:00"))).toBe(false);
  });
});

describe("isFresh — 장중에 받아둔 봉이 날을 넘긴 경우 (회귀)", () => {
  // 실제로 겪은 사고. 005930 의 08-27 봉을 15:19 에 받아 종가 265,000 으로
  // 저장했지만 확정 종가는 267,000 이었다.
  const 장중에_받음 = {
    latestTradeDate: "2026-08-27",
    fetchedAt: kst("2026-08-27T15:19:00").toISOString(),
  };

  it("날이 바뀌면 24시간이 안 지났어도 다시 받는다", () => {
    // 이 판정이 없으면 장중 스냅샷이 확정 종가 행세를 한다
    expect(isFresh(장중에_받음, "KR", FULL, FIVE_MIN, kst("2026-08-28T00:20:00"))).toBe(false);
  });

  it("장이 끝난 뒤에 받아둔 봉도 한 번은 다시 확인한다", () => {
    // 16:00 은 마감 후지만 달력 없이는 '마감 후'임을 단정할 수 없다.
    // 하루 한 번 더 받는 비용이, 틀린 종가로 퍼센타일을 계산하는 것보다 싸다.
    const 마감후에_받음 = {
      latestTradeDate: "2026-08-27",
      fetchedAt: kst("2026-08-27T16:00:00").toISOString(),
    };
    expect(isFresh(마감후에_받음, "KR", FULL, FIVE_MIN, kst("2026-08-28T00:20:00"))).toBe(false);
  });

  it("전 거래일에 받아둔 봉은 하루 안에서는 신선하다", () => {
    // 08-26 봉을 08-27 에 받았다면 그 시점에 이미 확정된 값이다.
    // 여기까지 의심하면 매 요청마다 토스를 부르게 된다.
    const 확정된_봉 = {
      latestTradeDate: "2026-08-26",
      fetchedAt: kst("2026-08-27T10:00:00").toISOString(),
    };
    expect(isFresh(확정된_봉, "KR", FULL, FIVE_MIN, kst("2026-08-27T20:00:00"))).toBe(true);
  });

  it("하루가 지나면 다음 거래일 봉을 확인하러 간다", () => {
    const 확정된_봉 = {
      latestTradeDate: "2026-08-26",
      fetchedAt: kst("2026-08-27T10:00:00").toISOString(),
    };
    expect(isFresh(확정된_봉, "KR", FULL, FIVE_MIN, kst("2026-08-28T11:00:00"))).toBe(false);
  });
});

describe("isFresh — 250봉 미달", () => {
  it("봉이 모자라면 하루에 한 번 다시 시도한다", () => {
    const state = {
      latestTradeDate: "2026-08-26",
      fetchedAt: kst("2026-08-26T20:00:00").toISOString(),
    };
    expect(isFresh(state, "KR", 120, FIVE_MIN, kst("2026-08-28T09:00:00"))).toBe(false);
  });
});
