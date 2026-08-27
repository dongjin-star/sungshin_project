/**
 * 관심종목 정렬 (PRD F-WATCH-03, §5.6)
 *
 * 가장 중요한 성질은 **값이 없는 행을 어디에 두는가**다. 위치를 모르는 종목이
 * "가장 낮은 위치"인 것처럼 맨 위에 올라오면, 앱이 모르는 것을 아는 척한 것이
 * 된다 (PP-03).
 */

import { describe, expect, it } from "vitest";

import { sortWatchlist, type SortState } from "../src/lib/watchlist/sort";
import type { BodyZone, WatchlistItem } from "../src/lib/types";

function item(
  symbol: string,
  name: string,
  percentile: number | null,
  zone: BodyZone | null = "WAIST",
): WatchlistItem {
  return {
    symbol,
    name,
    market: "KR",
    currency: "KRW",
    asOf: "2026-08-28T00:00:00Z",
    marketState: "CLOSED",
    price: { current: 1000, changeRate: 0 },
    position: percentile === null ? { percentile: null, zone: null } : { percentile, zone },
    trend: { alignment: "UP", crossType: null, crossDaysAgo: null },
  };
}

const ADDED = new Map([
  ["AAA", "2026-08-01T00:00:00Z"],
  ["BBB", "2026-08-03T00:00:00Z"],
  ["CCC", "2026-08-02T00:00:00Z"],
]);

const symbolsOf = (items: WatchlistItem[]): string[] => items.map((i) => i.symbol);

describe("sortWatchlist — 위치순", () => {
  const items = [item("AAA", "가나", 80), item("BBB", "다라", 20), item("CCC", "마바", 50)];

  it("오름차순은 낮은 위치가 먼저", () => {
    const sort: SortState = { mode: "position", order: "asc" };
    expect(symbolsOf(sortWatchlist(items, sort, ADDED))).toEqual(["BBB", "CCC", "AAA"]);
  });

  it("내림차순은 높은 위치가 먼저", () => {
    const sort: SortState = { mode: "position", order: "desc" };
    expect(symbolsOf(sortWatchlist(items, sort, ADDED))).toEqual(["AAA", "CCC", "BBB"]);
  });
});

describe("sortWatchlist — 값이 없는 행 (회귀)", () => {
  const items = [item("AAA", "가나", 80), item("BBB", "다라", null, null), item("CCC", "마바", 50)];

  it("오름차순에서도 맨 아래", () => {
    const sort: SortState = { mode: "position", order: "asc" };
    // null 을 0 처럼 다루면 BBB 가 맨 위로 온다 — 모른다는 것과 낮다는 것은 다르다
    expect(symbolsOf(sortWatchlist(items, sort, ADDED))).toEqual(["CCC", "AAA", "BBB"]);
  });

  it("내림차순에서도 맨 아래", () => {
    const sort: SortState = { mode: "position", order: "desc" };
    expect(symbolsOf(sortWatchlist(items, sort, ADDED))).toEqual(["AAA", "CCC", "BBB"]);
  });

  it("전부 값이 없으면 심볼순으로 안정된다", () => {
    const none = [item("CCC", "마바", null, null), item("AAA", "가나", null, null)];
    const sort: SortState = { mode: "position", order: "desc" };
    expect(symbolsOf(sortWatchlist(none, sort, ADDED))).toEqual(["AAA", "CCC"]);
  });
});

describe("sortWatchlist — 추가순", () => {
  const items = [item("AAA", "가나", 80), item("BBB", "다라", 20), item("CCC", "마바", 50)];

  it("먼저 담은 것이 위로", () => {
    const sort: SortState = { mode: "added", order: "asc" };
    expect(symbolsOf(sortWatchlist(items, sort, ADDED))).toEqual(["AAA", "CCC", "BBB"]);
  });

  it("추가 시각을 모르면 뒤로 밀리되 순서는 안정적이다", () => {
    const sort: SortState = { mode: "added", order: "asc" };
    const partial = new Map([["BBB", "2026-08-03T00:00:00Z"]]);
    // 빈 문자열끼리는 심볼순으로 갈린다 — 렌더할 때마다 순서가 바뀌면 안 된다
    expect(symbolsOf(sortWatchlist(items, sort, partial))).toEqual(["AAA", "CCC", "BBB"]);
  });
});

describe("sortWatchlist — 이름순", () => {
  it("한글 사전순으로 정렬한다", () => {
    const items = [item("AAA", "하늘", 80), item("BBB", "가람", 20), item("CCC", "나무", 50)];
    const sort: SortState = { mode: "name", order: "asc" };
    expect(symbolsOf(sortWatchlist(items, sort, ADDED))).toEqual(["BBB", "CCC", "AAA"]);
  });
});

describe("sortWatchlist — 원본 불변", () => {
  it("입력 배열을 건드리지 않는다", () => {
    const items = [item("AAA", "가나", 80), item("BBB", "다라", 20)];
    const before = symbolsOf(items);
    sortWatchlist(items, { mode: "position", order: "asc" }, ADDED);
    expect(symbolsOf(items)).toEqual(before);
  });
});
