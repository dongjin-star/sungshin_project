/**
 * 화면 1 상태 판정 (PRD §5.2)
 *
 * §5.2 가 정의한 여섯 상태가 전부 도달 가능한지, 그리고 **동시에 참이 될 수
 * 있는 조건들의 우선순위**가 맞는지를 본다. 우선순위가 틀리면 화면이 깜빡인다.
 */

import { describe, expect, it } from "vitest";

import { resolveState } from "../src/lib/search/screen-state";

describe("resolveState — 여섯 상태", () => {
  it("인덱스 로딩 중이면 INDEX_LOADING", () => {
    expect(resolveState("loading", "", "", 0)).toBe("INDEX_LOADING");
  });

  it("인덱스 실패면 INDEX_ERROR", () => {
    expect(resolveState("error", "", "", 0)).toBe("INDEX_ERROR");
  });

  it("입력이 비어 있으면 IDLE", () => {
    expect(resolveState("ready", "", "", 0)).toBe("IDLE");
  });

  it("디바운스가 아직 안 따라왔으면 TYPING", () => {
    expect(resolveState("ready", "삼성전", "삼성", 3)).toBe("TYPING");
  });

  it("결과가 있으면 RESULTS", () => {
    expect(resolveState("ready", "삼성", "삼성", 12)).toBe("RESULTS");
  });

  it("결과가 없으면 EMPTY", () => {
    expect(resolveState("ready", "ㅋㅋㅋㅋ", "ㅋㅋㅋㅋ", 0)).toBe("EMPTY");
  });
});

describe("resolveState — 우선순위", () => {
  it("인덱스 상태가 입력 상태를 이긴다", () => {
    // 인덱스를 못 받은 채로 글자를 치고 있어도 EMPTY 라고 말하면 안 된다.
    // "검색해도 안 나온다"와 "아직 검색할 수 없다"는 다른 사실이다.
    expect(resolveState("loading", "삼성전자", "삼성전자", 0)).toBe("INDEX_LOADING");
    expect(resolveState("error", "삼성전자", "삼성전자", 0)).toBe("INDEX_ERROR");
  });

  it("공백만 친 것은 입력이 아니다", () => {
    expect(resolveState("ready", "   ", "   ", 0)).toBe("IDLE");
  });

  it("지우는 중에도 TYPING 을 거친다", () => {
    // 마지막 글자를 지우는 순간 raw 는 비었지만 debounced 는 아직 남아 있다.
    // trim 검사가 먼저라 IDLE 로 간다 — 빈 입력창에 EMPTY 를 띄우지 않는다.
    expect(resolveState("ready", "", "삼성", 12)).toBe("IDLE");
  });

  it("타이핑 중에는 이전 결과 수와 무관하게 TYPING", () => {
    // 이 분기가 없으면 마지막 글자를 치는 찰나에 EMPTY 가 스쳐 지나간다 (PP-03)
    expect(resolveState("ready", "ㅋㅋㅋㅋ", "ㅋㅋㅋ", 0)).toBe("TYPING");
    expect(resolveState("ready", "삼성전자", "삼성전", 5)).toBe("TYPING");
  });
});
