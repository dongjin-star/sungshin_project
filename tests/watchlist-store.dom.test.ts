/**
 * 관심종목 저장소 (PRD F-WATCH-01, §6.2)
 *
 * 정원 20종목이 이 훅의 핵심 계약이다. 초과 시 **조용히 실패하면** 사용자는
 * 눌렀는데 아무 일도 안 일어난 것으로 보고 앱이 고장났다고 생각한다.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { MAX_WATCHLIST, useWatchlist } from "../src/lib/watchlist/store";

const KEY = "posture.watchlist.v1";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe("useWatchlist — 기본 동작", () => {
  it("처음에는 비어 있고 ready 가 선다", () => {
    const { result } = renderHook(() => useWatchlist());
    expect(result.current.items).toEqual([]);
    expect(result.current.ready).toBe(true);
  });

  it("담으면 localStorage 에 남는다", () => {
    const { result } = renderHook(() => useWatchlist());

    act(() => {
      result.current.add("005930");
    });

    expect(result.current.has("005930")).toBe(true);
    const saved = JSON.parse(window.localStorage.getItem(KEY) ?? "[]");
    expect(saved).toHaveLength(1);
    expect(saved[0].symbol).toBe("005930");
    expect(typeof saved[0].addedAt).toBe("string");
  });

  it("같은 종목을 두 번 담아도 하나다", () => {
    const { result } = renderHook(() => useWatchlist());

    act(() => {
      result.current.add("005930");
    });
    act(() => {
      result.current.add("005930");
    });

    expect(result.current.items).toHaveLength(1);
  });

  it("빼면 사라진다", () => {
    const { result } = renderHook(() => useWatchlist());

    act(() => {
      result.current.add("005930");
    });
    act(() => {
      result.current.remove("005930");
    });

    expect(result.current.has("005930")).toBe(false);
    expect(JSON.parse(window.localStorage.getItem(KEY) ?? "[]")).toEqual([]);
  });
});

describe("useWatchlist — 정원", () => {
  it(`${MAX_WATCHLIST}개까지 담긴다`, () => {
    const { result } = renderHook(() => useWatchlist());

    for (let i = 0; i < MAX_WATCHLIST; i += 1) {
      act(() => {
        result.current.add(`SYM${i}`);
      });
    }

    expect(result.current.items).toHaveLength(MAX_WATCHLIST);
    expect(result.current.isFull).toBe(true);
  });

  it("초과하면 add 가 false 를 돌려준다 (조용히 실패하지 않는다)", () => {
    const { result } = renderHook(() => useWatchlist());

    for (let i = 0; i < MAX_WATCHLIST; i += 1) {
      act(() => {
        result.current.add(`SYM${i}`);
      });
    }

    let accepted = true;
    act(() => {
      accepted = result.current.add("OVERFLOW");
    });

    expect(accepted).toBe(false);
    expect(result.current.items).toHaveLength(MAX_WATCHLIST);
    expect(result.current.has("OVERFLOW")).toBe(false);
  });

  it("정원이 찼어도 이미 담긴 종목은 성공으로 본다", () => {
    const { result } = renderHook(() => useWatchlist());

    for (let i = 0; i < MAX_WATCHLIST; i += 1) {
      act(() => {
        result.current.add(`SYM${i}`);
      });
    }

    let accepted = false;
    act(() => {
      accepted = result.current.add("SYM0");
    });

    expect(accepted).toBe(true);
  });
});

describe("useWatchlist — 저장된 값을 믿지 않는다", () => {
  it("깨진 JSON 이면 빈 목록으로 시작한다", () => {
    window.localStorage.setItem(KEY, "{{{");
    const { result } = renderHook(() => useWatchlist());
    expect(result.current.items).toEqual([]);
  });

  it("배열이 아니면 빈 목록", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ symbol: "005930" }));
    const { result } = renderHook(() => useWatchlist());
    expect(result.current.items).toEqual([]);
  });

  it("형식이 틀린 항목은 걸러낸다", () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify([
        { symbol: "005930", addedAt: "2026-08-01T00:00:00Z" },
        { symbol: "" },
        { nope: true },
        null,
      ]),
    );
    const { result } = renderHook(() => useWatchlist());
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0]!.symbol).toBe("005930");
  });

  it("저장된 항목이 정원을 넘으면 잘라낸다", () => {
    const many = Array.from({ length: MAX_WATCHLIST + 5 }, (_, i) => ({
      symbol: `SYM${i}`,
      addedAt: "2026-08-01T00:00:00Z",
    }));
    window.localStorage.setItem(KEY, JSON.stringify(many));

    const { result } = renderHook(() => useWatchlist());
    expect(result.current.items).toHaveLength(MAX_WATCHLIST);
  });
});

describe("useWatchlist — toggle", () => {
  it("없으면 담고 있으면 뺀다", () => {
    const { result } = renderHook(() => useWatchlist());

    let on = false;
    act(() => {
      on = result.current.toggle("AAPL");
    });
    expect(on).toBe(true);
    expect(result.current.has("AAPL")).toBe(true);

    act(() => {
      on = result.current.toggle("AAPL");
    });
    expect(on).toBe(false);
    expect(result.current.has("AAPL")).toBe(false);
  });
});
