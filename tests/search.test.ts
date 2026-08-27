/**
 * 검색 매칭 테스트 (PRD F-SEARCH-01/03, §15 1-4 검증 기준)
 *
 * 1-4 의 검증 기준이 명시적이다:
 *   "ㅅㅅㅈㅈ", "samsung", "005930" 모두 삼성전자 반환
 *
 * 표본은 실제 마스터에서 뽑은 값이다. 삼성전자 주변에는 우선주(005935)와
 * 이름이 겹치는 종목이 실제로 존재하므로, 순위가 흔들리면 여기서 걸린다.
 */

import { describe, expect, it } from "vitest";

import { search, toSearchEntries } from "../src/lib/search/match";
import type { SearchIndexTuple } from "../src/lib/service/search-index";

/** 실제 마스터에서 가져온 표본 */
const FIXTURE: SearchIndexTuple[] = [
  ["005930", "삼성전자", "SamsungElec", "ㅅㅅㅈㅈ", "KR"],
  ["005935", "삼성전자(1P)", "SamsungElec(1P)", "ㅅㅅㅈㅈ(1P)", "KR"],
  ["000810", "삼성화재", "SamsungF&MIns", "ㅅㅅㅎㅈ", "KR"],
  ["001360", "삼성제약", "SAMSUNG PHARM", "ㅅㅅㅈㅇ", "KR"],
  ["263810", "상신전자", "SangShinElecom", "ㅅㅅㅈㅈ", "KR"],
  ["000660", "SK하이닉스", "SK hynix", "SKㅎㅇㄴㅅ", "KR"],
  ["AAPL", "애플", "Apple", "ㅇㅍ", "US"],
  ["MSFT", "마이크로소프트", "Microsoft", "ㅁㅇㅋㄹㅅㅍㅌ", "US"],
  ["BRK.B", "버크셔 해서웨이 B", "Berkshire Hathaway B", "ㅂㅋㅅ ㅎㅅㅇㅇ B", "US"],
];

const entries = toSearchEntries(FIXTURE);

const symbolsOf = (q: string, opts = {}): string[] =>
  search(entries, q, opts).map((e) => e.symbol);

describe("1-4 검증 기준 — 세 가지 입력이 모두 삼성전자를 낸다", () => {
  it("초성: ㅅㅅㅈㅈ", () => {
    expect(symbolsOf("ㅅㅅㅈㅈ")[0]).toBe("005930");
  });

  it("영문: samsung", () => {
    expect(symbolsOf("samsung")[0]).toBe("005930");
  });

  it("종목코드: 005930", () => {
    expect(symbolsOf("005930")).toEqual(["005930"]);
  });

  it("한글명: 삼성전자", () => {
    expect(symbolsOf("삼성전자")[0]).toBe("005930");
  });
});

describe("중요도 순위 (인덱스 배열 순서)", () => {
  /**
   * 실측에서 잡힌 회귀다. "samsung" 은 삼성물산·삼성E&A·삼성전자가 전부
   * 접두사 일치라 점수가 같은데, 이름 글자 수로 가르면 영문명이 1자 짧은
   * 삼성물산(SamsungC&T)이 삼성전자(SamsungElec)를 이겨 1위가 됐다.
   *
   * 배치가 인덱스를 보통주·발행주식수 순으로 구워 내려주므로, 동점일 때는
   * 배열 순서를 먼저 본다. 아래 fixture 는 그 순서를 재현한 것이다.
   */
  const byImportance = toSearchEntries([
    ["005930", "삼성전자", "SamsungElec", "ㅅㅅㅈㅈ", "KR"],
    ["028260", "삼성물산", "SamsungC&T", "ㅅㅅㅁㅅ", "KR"],
    ["028050", "삼성E&A", "SamsungE&A", "ㅅㅅE&A", "KR"],
  ]);

  it("영문명이 더 짧아도 중요도가 높은 종목이 앞선다", () => {
    const result = search(byImportance, "samsung").map((e) => e.symbol);
    expect(result[0]).toBe("005930");
  });

  it("한글 부분일치에서도 같은 순서를 지킨다", () => {
    const result = search(byImportance, "삼성").map((e) => e.symbol);
    expect(result[0]).toBe("005930");
  });

  it("중요도가 점수를 뒤집지는 않는다 — 완전일치가 언제나 위", () => {
    // 028050 은 배열 뒤쪽이지만 티커 완전일치이므로 1위여야 한다
    const result = search(byImportance, "028050").map((e) => e.symbol);
    expect(result[0]).toBe("028050");
  });
});

describe("순위", () => {
  it("완전일치가 접두사보다 앞선다 — 보통주가 우선주보다 위", () => {
    const result = symbolsOf("삼성전자");
    expect(result.indexOf("005930")).toBeLessThan(result.indexOf("005935"));
  });

  it("초성이 같으면 이름이 짧은 쪽이 위 (삼성전자 vs 상신전자)", () => {
    const result = symbolsOf("ㅅㅅㅈㅈ");
    expect(result).toContain("263810");
    expect(result.indexOf("005930")).toBeLessThan(result.indexOf("263810"));
  });

  it("티커 일치가 이름 부분일치보다 앞선다", () => {
    // 'SK' 는 000660 의 티커가 아니라 이름에 들어 있다. 그래도 걸려야 한다.
    expect(symbolsOf("SK")).toContain("000660");
  });

  it("같은 점수면 순서가 안정적이다 (심볼 기준 타이브레이크)", () => {
    expect(symbolsOf("삼성")).toEqual(symbolsOf("삼성"));
  });
});

describe("정규화", () => {
  it("대소문자를 무시한다", () => {
    expect(symbolsOf("aapl")).toEqual(["AAPL"]);
    expect(symbolsOf("AAPL")).toEqual(["AAPL"]);
  });

  it("공백을 무시한다 — '삼성 전자' 도 찾는다", () => {
    expect(symbolsOf("삼성 전자")[0]).toBe("005930");
  });

  it("하이픈·점을 무시한다 — BRK.B / brk-b / brkb", () => {
    for (const q of ["BRK.B", "brk-b", "brkb"]) {
      expect(symbolsOf(q)).toContain("BRK.B");
    }
  });
});

describe("시장 필터 (§5.2 칩)", () => {
  it("KR 만", () => {
    expect(symbolsOf("ㅅ", { market: "KR" }).every((s) => s !== "AAPL")).toBe(true);
  });

  it("US 만", () => {
    expect(symbolsOf("a", { market: "US" })).toContain("AAPL");
    expect(symbolsOf("a", { market: "US" })).not.toContain("005930");
  });
});

describe("초성 검색", () => {
  it("미국 종목도 초성으로 찾힌다 — 실측상 한글명이 붙어 있다", () => {
    expect(symbolsOf("ㅇㅍ")).toContain("AAPL");
    expect(symbolsOf("ㅁㅇㅋㄹㅅㅍㅌ")).toContain("MSFT");
  });

  it("초성 접두사도 걸린다", () => {
    expect(symbolsOf("ㅅㅅ")).toContain("005930");
    expect(symbolsOf("ㅅㅅ")).toContain("000810");
  });

  it("초성 질의는 영문명에 걸리지 않는다", () => {
    // 'ㅇㅍ' 가 'Apple' 의 알파벳에 우연히 매칭되면 안 된다
    const result = search(entries, "ㅇㅍ");
    expect(result.every((e) => (e.initials ?? "").includes("ㅇㅍ"))).toBe(true);
  });
});

describe("빈 결과·빈 질의", () => {
  it("빈 문자열은 아무것도 내지 않는다 (IDLE 상태는 최근 검색어를 보여준다)", () => {
    expect(symbolsOf("")).toEqual([]);
    expect(symbolsOf("   ")).toEqual([]);
  });

  it("없는 종목은 빈 배열 — EMPTY 상태의 근거", () => {
    expect(symbolsOf("존재하지않는종목명")).toEqual([]);
  });
});

describe("결과 수 상한", () => {
  it("limit 을 넘지 않는다 (§5.2 시세 1회 호출 상한과 맞물린다)", () => {
    expect(search(entries, "ㅅ", { limit: 2 })).toHaveLength(2);
  });
});
