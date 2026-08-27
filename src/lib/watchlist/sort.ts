/**
 * 관심종목 정렬 (PRD F-WATCH-03, §5.6)
 *
 * 순수 함수로 둔다 — 정렬은 화면 5 의 핵심 기능이고, 값이 없는 행(계산 실패,
 * 신규 상장)을 어디에 놓느냐가 눈에 띄게 드러나기 때문이다.
 *
 * 🔑 **값이 없는 행은 방향과 무관하게 항상 아래로 보낸다.**
 *    내림차순에서 null 을 -∞ 로, 오름차순에서 +∞ 로 두면 위치를 모르는
 *    종목이 "가장 낮은 위치"인 것처럼 맨 위에 올라온다. 모른다는 것과
 *    낮다는 것은 다른 사실이다 (PP-03).
 */

import type { WatchlistItem } from "../types";

export type SortMode = "position" | "added" | "name";
export type SortOrder = "asc" | "desc";

export interface SortState {
  mode: SortMode;
  order: SortOrder;
}

export const DEFAULT_SORT: SortState = { mode: "added", order: "asc" };

export const SORT_LABELS: Record<SortMode, string> = {
  position: "위치순",
  added: "추가순",
  name: "이름순",
};

/**
 * @param items    서버가 돌려준 행들
 * @param addedAt  심볼 → 추가 시각. '추가순'의 기준이며 서버는 모르는 값이다
 */
export function sortWatchlist(
  items: readonly WatchlistItem[],
  sort: SortState,
  addedAt: ReadonlyMap<string, string>,
): WatchlistItem[] {
  const sign = sort.order === "asc" ? 1 : -1;

  return [...items].sort((a, b) => {
    if (sort.mode === "name") {
      return sign * a.name.localeCompare(b.name, "ko");
    }

    if (sort.mode === "added") {
      const av = addedAt.get(a.symbol) ?? "";
      const bv = addedAt.get(b.symbol) ?? "";
      if (av !== bv) return sign * av.localeCompare(bv);
      return a.symbol.localeCompare(b.symbol);
    }

    // position — 값이 없으면 방향과 무관하게 아래로
    const ap = a.position?.percentile ?? null;
    const bp = b.position?.percentile ?? null;
    if (ap === null && bp === null) return a.symbol.localeCompare(b.symbol);
    if (ap === null) return 1;
    if (bp === null) return -1;
    if (ap !== bp) return sign * (ap - bp);
    return a.symbol.localeCompare(b.symbol);
  });
}
