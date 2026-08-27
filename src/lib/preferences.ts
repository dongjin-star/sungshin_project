"use client";

/**
 * 사용자 설정 (PRD §6.2 `LocalState.preferences`)
 *
 * 기간·정렬·시장 필터는 화면을 옮겨 다녀도 유지돼야 한다. 관심종목에서
 * 250일로 맞춰놓고 종목을 눌렀는데 120일로 돌아가면, 사용자는 자기가 보던
 * 척도를 잃는다.
 */

import { useCallback, useEffect, useState } from "react";

import { DEFAULT_SORT, type SortState } from "./watchlist/sort";
import { DEFAULT_PERIOD, PERIOD_OPTIONS, type Market, type PeriodDays } from "./types";

const KEY = "posture.preferences.v1";

export interface Preferences {
  periodDays: PeriodDays;
  watchlistSort: SortState;
  marketFilter: Market | null;
}

const DEFAULTS: Preferences = {
  periodDays: DEFAULT_PERIOD,
  watchlistSort: DEFAULT_SORT,
  marketFilter: null,
};

/** 저장된 값을 믿지 않는다. 사용자가 직접 고칠 수 있는 저장소다 */
function parse(raw: unknown): Preferences {
  if (typeof raw !== "object" || raw === null) return DEFAULTS;
  const v = raw as Partial<Preferences>;

  const periodDays =
    typeof v.periodDays === "number" && PERIOD_OPTIONS.includes(v.periodDays as PeriodDays)
      ? (v.periodDays as PeriodDays)
      : DEFAULTS.periodDays;

  const sort = v.watchlistSort;
  const watchlistSort: SortState =
    typeof sort === "object" &&
    sort !== null &&
    (sort.mode === "position" || sort.mode === "added" || sort.mode === "name") &&
    (sort.order === "asc" || sort.order === "desc")
      ? { mode: sort.mode, order: sort.order }
      : DEFAULTS.watchlistSort;

  const marketFilter =
    v.marketFilter === "KR" || v.marketFilter === "US" ? v.marketFilter : null;

  return { periodDays, watchlistSort, marketFilter };
}

function read(): Preferences {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw === null) return DEFAULTS;
    return parse(JSON.parse(raw));
  } catch {
    return DEFAULTS;
  }
}

export function usePreferences() {
  const [prefs, setPrefs] = useState<Preferences>(DEFAULTS);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setPrefs(read());
    setReady(true);
  }, []);

  const update = useCallback((patch: Partial<Preferences>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      try {
        window.localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // 저장 실패가 화면을 막을 이유는 없다
      }
      return next;
    });
  }, []);

  return { prefs, ready, update };
}
