/**
 * 장 운영 상태 판정 (PRD §12.3, F-STATE-03)
 *
 * 아래 픽스처는 2026-08-27/28 토스 캘린더 **실제 응답**을 줄인 것이다.
 * 미국 정규장이 KST 자정을 가로지른다는 사실이 이 테스트의 전부다.
 */

import { describe, expect, it } from "vitest";

import { marketStateOf, referenceTradeDate } from "../src/lib/market/calendar";

/** 실측: US 는 today.regularMarket (한 겹) */
const US = {
  previousBusinessDay: {
    date: "2026-08-27",
    regularMarket: {
      startTime: "2026-08-27T22:30:00.000+09:00",
      endTime: "2026-08-28T05:00:00.000+09:00",
    },
  },
  today: {
    date: "2026-08-28",
    regularMarket: {
      startTime: "2026-08-28T22:30:00.000+09:00",
      endTime: "2026-08-29T05:00:00.000+09:00",
    },
  },
};

/** 실측: KR 은 today.integrated.regularMarket (두 겹) */
const KR = {
  previousBusinessDay: {
    date: "2026-08-27",
    integrated: {
      regularMarket: {
        startTime: "2026-08-27T09:00:00.000+09:00",
        endTime: "2026-08-27T15:30:00.000+09:00",
      },
    },
  },
  today: {
    date: "2026-08-28",
    integrated: {
      regularMarket: {
        startTime: "2026-08-28T09:00:00.000+09:00",
        endTime: "2026-08-28T15:30:00.000+09:00",
      },
    },
  },
};

const at = (kst: string): Date => new Date(`${kst}+09:00`);

describe("marketStateOf — 미국 정규장이 KST 자정을 넘는 경우 (회귀)", () => {
  it("00:49 KST 는 전날 세션이 돌아가는 중이므로 OPEN", () => {
    // 08-28 00:49 KST = 08-27 11:49 ET. NYSE 정규장 한복판이다.
    // `today`(08-28)만 보면 CLOSED 가 나온다 — 이 테스트가 그것을 막는다.
    expect(marketStateOf(US, at("2026-08-28T00:49:00"))).toBe("OPEN");
  });

  it("세션 뒤쪽 5시간(00:00~05:00 KST) 전체가 OPEN 이다", () => {
    for (const kst of ["2026-08-28T00:00:01", "2026-08-28T02:30:00", "2026-08-28T04:59:00"]) {
      expect(marketStateOf(US, at(kst))).toBe("OPEN");
    }
  });

  it("세션 앞쪽(22:30~24:00 KST)도 OPEN 이다", () => {
    expect(marketStateOf(US, at("2026-08-27T22:30:00"))).toBe("OPEN");
    expect(marketStateOf(US, at("2026-08-27T23:59:00"))).toBe("OPEN");
  });

  it("종료 시각 05:00 은 이미 닫힌 것으로 본다", () => {
    expect(marketStateOf(US, at("2026-08-28T05:00:00"))).toBe("CLOSED");
  });

  it("프리마켓 시간대는 CLOSED (§12.3 — 프리·애프터 시세는 쓰지 않는다)", () => {
    // 08-28 20:00 KST = 07:00 ET. 프리마켓이지만 정규장은 아니다.
    expect(marketStateOf(US, at("2026-08-28T20:00:00"))).toBe("CLOSED");
  });
});

describe("marketStateOf — 국내", () => {
  it("정규장 중에는 OPEN", () => {
    expect(marketStateOf(KR, at("2026-08-28T10:30:00"))).toBe("OPEN");
  });

  it("자정 무렵은 CLOSED — 국내장은 날짜를 넘지 않는다", () => {
    expect(marketStateOf(KR, at("2026-08-28T00:49:00"))).toBe("CLOSED");
  });

  it("장 마감 직후는 CLOSED", () => {
    expect(marketStateOf(KR, at("2026-08-28T15:30:00"))).toBe("CLOSED");
  });
});

describe("marketStateOf — 휴장", () => {
  it("오늘 정규장 구간이 없으면 HOLIDAY", () => {
    expect(marketStateOf({ today: { date: "2026-08-15" } }, at("2026-08-15T10:00:00"))).toBe(
      "HOLIDAY",
    );
  });

  it("today 자체가 없어도 HOLIDAY", () => {
    expect(marketStateOf({}, at("2026-08-15T10:00:00"))).toBe("HOLIDAY");
  });

  it("휴장일이라도 직전 세션이 아직 돌아가면 OPEN 이 우선한다", () => {
    // 금요일 밤 시작한 미국 세션은 KST 토요일 새벽까지 이어진다.
    // 토요일이 영업일이 아니라고 해서 NYSE 가 닫힌 것은 아니다.
    const weekend = {
      previousBusinessDay: US.previousBusinessDay,
      today: { date: "2026-08-29" },
    };
    expect(marketStateOf(weekend, at("2026-08-28T03:00:00"))).toBe("OPEN");
  });
});

describe("referenceTradeDate", () => {
  it("장중이면 지금 돌아가는 세션의 날짜를 쓴다", () => {
    // today 는 08-28 이지만 실제로 열려 있는 세션은 08-27 것이다
    expect(referenceTradeDate(US, "OPEN", at("2026-08-28T00:49:00"))).toBe("2026-08-27");
  });

  it("장이 닫혔으면 직전 영업일", () => {
    expect(referenceTradeDate(KR, "CLOSED", at("2026-08-28T00:49:00"))).toBe("2026-08-27");
  });
});
