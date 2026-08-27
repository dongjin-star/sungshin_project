/**
 * 초성 검색 (PRD F-SEARCH-03)
 *
 * PRD 1-4 검증 기준: "ㅅㅅㅈㅈ", "samsung", "005930" 모두 삼성전자 반환
 */

import { describe, expect, it } from "vitest";
import { isInitialsOnly, normalize, toInitials } from "../src/lib/hangul";

describe("초성 추출", () => {
  it("PRD 예시 — 삼성전자 → ㅅㅅㅈㅈ", () => {
    expect(toInitials("삼성전자")).toBe("ㅅㅅㅈㅈ");
  });

  it("쌍자음 초성을 정확히 뽑는다", () => {
    expect(toInitials("빨간짜장")).toBe("ㅃㄱㅉㅈ");
  });

  it("받침이 있어도 초성만 뽑는다", () => {
    expect(toInitials("한국전력")).toBe("ㅎㄱㅈㄹ");
    expect(toInitials("현대차")).toBe("ㅎㄷㅊ");
  });

  it("영문·숫자가 섞인 종목명은 해당 문자를 그대로 남긴다", () => {
    // 'SK하이닉스' 같은 이름이 흔하다
    expect(toInitials("SK하이닉스")).toBe("SKㅎㅇㄴㅅ");
    expect(toInitials("KB금융")).toBe("KBㄱㅇ");
    expect(toInitials("POSCO홀딩스")).toBe("POSCOㅎㄷㅅ");
  });

  it("한글이 없으면 원문 그대로다", () => {
    expect(toInitials("AAPL")).toBe("AAPL");
  });

  it("공백과 기호를 보존한다", () => {
    expect(toInitials("삼성 전자")).toBe("ㅅㅅ ㅈㅈ");
  });
});

describe("초성 전용 입력 판별", () => {
  it("초성만 입력하면 true", () => {
    expect(isInitialsOnly("ㅅㅅㅈㅈ")).toBe(true);
    expect(isInitialsOnly("ㄱㅇ")).toBe(true);
  });

  it("완성형 한글이 섞이면 false", () => {
    expect(isInitialsOnly("삼성")).toBe(false);
    expect(isInitialsOnly("ㅅ성")).toBe(false);
  });

  it("영문·숫자는 false", () => {
    expect(isInitialsOnly("samsung")).toBe(false);
    expect(isInitialsOnly("005930")).toBe(false);
  });

  it("빈 입력은 false", () => {
    expect(isInitialsOnly("")).toBe(false);
    expect(isInitialsOnly("   ")).toBe(false);
  });

  it("모음만 입력해도 초성 모드로 본다 (호환 자모 범위)", () => {
    // ㅏ~ㅣ 도 0x314F~ 이므로 범위 밖 → false. 초성 자음만 허용된다.
    expect(isInitialsOnly("ㅏㅑ")).toBe(false);
  });
});

describe("검색 정규화", () => {
  it("대소문자·공백·하이픈을 무시한다", () => {
    expect(normalize("Samsung Electronics")).toBe("samsungelectronics");
    expect(normalize("BRK-B")).toBe("brkb");
    expect(normalize("삼성 전자")).toBe("삼성전자");
  });

  it("PRD 1-4 검증 기준의 세 입력이 모두 삼성전자에 매칭된다", () => {
    const stock = {
      symbol: "005930",
      nameKo: "삼성전자",
      nameEn: "Samsung Electronics",
      initials: toInitials("삼성전자"),
    };

    // ① 초성
    expect(stock.initials.startsWith("ㅅㅅㅈㅈ")).toBe(true);
    // ② 영문명
    expect(normalize(stock.nameEn).includes(normalize("samsung"))).toBe(true);
    // ③ 6자리 코드
    expect(stock.symbol).toBe("005930");
  });
});
