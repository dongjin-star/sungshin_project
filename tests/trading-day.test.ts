/**
 * 거래일 인덱싱 테스트 (PRD §7.1)
 *
 * 여기 쓰인 timestamp 는 전부 Phase 0-4 실측값이다
 * (docs/probe/candles-AAPL-page1.json, candles-005930-page1.json).
 * 손으로 지어낸 값이 아니므로, 이 테스트가 깨지면 토스가 응답 형식을
 * 바꿨다는 뜻이다.
 */

import { describe, expect, it } from "vitest";

import {
  MARKET_OF_SEGMENT,
  inferMarket,
  isFormingBar,
  todayInMarket,
  tradeDateOf,
} from "../src/lib/toss/trading-day";

describe("tradeDateOf — 국내", () => {
  it("자정 KST 봉을 그 날짜로 인덱싱한다", () => {
    expect(tradeDateOf("2026-08-27T00:00:00.000+09:00", "KR")).toBe("2026-08-27");
  });

  it("연말 경계에서도 어긋나지 않는다", () => {
    expect(tradeDateOf("2026-01-02T00:00:00.000+09:00", "KR")).toBe("2026-01-02");
  });
});

describe("tradeDateOf — 미국", () => {
  /**
   * 핵심 실측: 오프셋은 항상 +09:00 인데 벽시계 시각이 계절에 따라 갈린다.
   * 서머타임(EDT)이면 13:00 KST, 표준시(EST)면 14:00 KST 다.
   * 둘 다 뉴욕 자정이고, 따라서 둘 다 그 날짜의 봉이다.
   */
  it("EDT 구간의 13:00 KST 봉 (실측 2026-08-27)", () => {
    expect(tradeDateOf("2026-08-27T13:00:00.000+09:00", "US")).toBe("2026-08-27");
  });

  it("EST 구간의 14:00 KST 봉 (실측 2026-03-06)", () => {
    expect(tradeDateOf("2026-03-06T14:00:00.000+09:00", "US")).toBe("2026-03-06");
  });

  it("서머타임 경계를 사이에 두고도 날짜가 연속한다", () => {
    // 2026-03-08 이 미국 서머타임 시작일이다. 그 앞뒤 실측 봉.
    const before = tradeDateOf("2026-03-06T14:00:00.000+09:00", "US");
    const after = tradeDateOf("2026-03-09T13:00:00.000+09:00", "US");
    expect(before).toBe("2026-03-06");
    expect(after).toBe("2026-03-09");
  });

  it("두 시각 모두 실제로 뉴욕 자정을 가리킨다", () => {
    const hourInNewYork = (ts: string): string =>
      new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        hour: "2-digit",
        hour12: false,
      }).format(new Date(ts));

    expect(hourInNewYork("2026-08-27T13:00:00.000+09:00")).toBe("00");
    expect(hourInNewYork("2026-03-06T14:00:00.000+09:00")).toBe("00");
  });

  it("같은 순간이라도 시장이 다르면 거래일이 달라질 수 있다", () => {
    // 뉴욕 자정 = 서울 오후. 시장을 잘못 넘기면 조용히 틀린 날짜가 나온다.
    const ts = "2026-08-27T13:00:00.000+09:00";
    expect(tradeDateOf(ts, "US")).toBe("2026-08-27");
    expect(tradeDateOf(ts, "KR")).toBe("2026-08-27");

    // 서울 자정 = 뉴욕 전날 오전. 이쪽이 실제로 갈리는 경우다.
    const midnightSeoul = "2026-08-27T00:00:00.000+09:00";
    expect(tradeDateOf(midnightSeoul, "KR")).toBe("2026-08-27");
    expect(tradeDateOf(midnightSeoul, "US")).toBe("2026-08-26");
  });

  it("파싱할 수 없는 timestamp 는 조용히 넘어가지 않고 던진다", () => {
    expect(() => tradeDateOf("어제", "US")).toThrow();
  });
});

describe("todayInMarket", () => {
  it("같은 순간을 시장별 현지 날짜로 환산한다", () => {
    // 2026-08-27 09:00 KST = 2026-08-26 20:00 EDT
    const now = new Date("2026-08-27T09:00:00.000+09:00");
    expect(todayInMarket("KR", now)).toBe("2026-08-27");
    expect(todayInMarket("US", now)).toBe("2026-08-26");
  });
});

describe("isFormingBar", () => {
  /**
   * §7.1(분포에서 당일 제외)과 §7.4(장중 최신 봉에 현재가 대입)는 둘 다
   * "배열의 마지막 원소 = 당일 봉"을 전제한다. 그 전제가 성립하는지
   * 판정하는 것이 이 함수다.
   */
  it("최신 봉 날짜가 시장 현지 오늘이면 진행 중인 봉이다", () => {
    const now = new Date("2026-08-27T15:19:00.000+09:00");
    expect(isFormingBar("2026-08-27", "KR", now)).toBe(true);
  });

  it("마감된 과거 봉은 진행 중이 아니다", () => {
    const now = new Date("2026-08-27T15:19:00.000+09:00");
    expect(isFormingBar("2026-08-26", "KR", now)).toBe(false);
  });

  it("한국 오후에 받은 미국 당일 봉도 진행 중으로 잡힌다", () => {
    // 실측 상황: 15:19 KST = 02:19 EDT. 미국 정규장은 아직 열리지도
    // 않았지만(22:30 KST 개장) 뉴욕 날짜는 이미 08-27 이고, 실제로
    // 2026-08-27 봉이 존재하며 프리마켓 체결이 쌓이고 있었다
    // (거래량 93,913 = 직전 20봉 중앙값의 0.2%).
    const now = new Date("2026-08-27T15:19:00.000+09:00");
    expect(todayInMarket("US", now)).toBe("2026-08-27");
    expect(isFormingBar("2026-08-27", "US", now)).toBe(true);
  });

  it("뉴욕이 아직 전날이면 같은 날짜라도 당일 봉이 아니다", () => {
    // 09:00 KST = 전날 20:00 EDT. 시장별로 '오늘'이 다르다는 것이 요점이다.
    const now = new Date("2026-08-27T09:00:00.000+09:00");
    expect(todayInMarket("US", now)).toBe("2026-08-26");
    expect(isFormingBar("2026-08-26", "US", now)).toBe(true);
    expect(isFormingBar("2026-08-27", "US", now)).toBe(false);
  });
});

describe("시장 판정", () => {
  it("세그먼트를 KR/US 로 접는다", () => {
    expect(MARKET_OF_SEGMENT.KOSPI).toBe("KR");
    expect(MARKET_OF_SEGMENT.KOSDAQ).toBe("KR");
    expect(MARKET_OF_SEGMENT.KR_ETC).toBe("KR");
    expect(MARKET_OF_SEGMENT.NYSE).toBe("US");
    expect(MARKET_OF_SEGMENT.NASDAQ).toBe("US");
    expect(MARKET_OF_SEGMENT.AMEX).toBe("US");
    expect(MARKET_OF_SEGMENT.US_ETC).toBe("US");
  });

  it("6자리 숫자 심볼은 국내로 추정한다", () => {
    expect(inferMarket("005930")).toBe("KR");
    expect(inferMarket("000660")).toBe("KR");
    expect(inferMarket("AAPL")).toBe("US");
    expect(inferMarket("BRK.B")).toBe("US");
  });
});
