"use client";

/**
 * 관심종목 저장소 (PRD F-WATCH-01, §6.2)
 *
 * Phase 1 은 계정이 없다. 관심종목은 localStorage 에만 있고 서버로 가지
 * 않는다 — §6.3 이 계정을 도입할 때 `watchlist_item` 테이블로 옮긴다.
 *
 * 저장 형태는 §6.2 의 `LocalState.watchlist` 를 그대로 따른다:
 *   { symbol, addedAt }[]   최대 20
 *
 * ⚠️ 심볼만 저장한다. 종목명·가격은 저장하지 않는다. 이름은 바뀔 수 있고
 *    가격은 반드시 낡기 때문이다. 화면에 필요한 값은 매번 받아온다.
 */

import { useCallback, useEffect, useState } from "react";

const KEY = "posture.watchlist.v1";

/** §5.6 — 초과 시 추가를 막고 안내한다 */
export const MAX_WATCHLIST = 20;

export interface WatchlistEntry {
  symbol: string;
  /** ISO 8601. '추가순' 정렬의 기준 */
  addedAt: string;
}

function isEntry(v: unknown): v is WatchlistEntry {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as WatchlistEntry).symbol === "string" &&
    (v as WatchlistEntry).symbol.length > 0
  );
}

function read(): WatchlistEntry[] {
  // SSR·프라이빗 모드·저장소 차단 — 어느 쪽이든 빈 목록으로 동작해야 한다
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isEntry).slice(0, MAX_WATCHLIST);
  } catch {
    return [];
  }
}

function write(items: readonly WatchlistEntry[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    // 저장에 실패해도 화면은 계속 동작해야 한다. 다음 진입 때 비어 있을 뿐이다.
  }
}

export interface WatchlistStore {
  items: WatchlistEntry[];
  /** localStorage 를 읽기 전인가. 읽기 전에 EMPTY 로 단정하면 화면이 깜빡인다 */
  ready: boolean;
  has: (symbol: string) => boolean;
  /** 추가 성공 여부. 정원이 찼으면 false */
  add: (symbol: string) => boolean;
  remove: (symbol: string) => void;
  toggle: (symbol: string) => boolean;
  isFull: boolean;
}

export function useWatchlist(): WatchlistStore {
  const [items, setItems] = useState<WatchlistEntry[]>([]);
  const [ready, setReady] = useState(false);

  // localStorage 는 서버에 없다. 첫 렌더를 서버와 맞추고 나서 채운다 —
  // 아니면 hydration 불일치가 난다.
  useEffect(() => {
    setItems(read());
    setReady(true);
  }, []);

  // 다른 탭에서 바뀌면 따라간다. 관심종목을 두 탭에 띄워두는 일은 흔하다.
  useEffect(() => {
    const onStorage = (e: StorageEvent): void => {
      if (e.key === KEY) setItems(read());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const has = useCallback(
    (symbol: string) => items.some((i) => i.symbol === symbol),
    [items],
  );

  // ⚠️ 판단을 `setItems` 업데이터 **안**에서 하지 않는다.
  //
  //    React 는 업데이터를 즉시 실행하지 않으므로, 그 안에서 정한 값을 밖으로
  //    빼내 반환하면 호출자는 항상 초기값을 받는다. `add` 가 늘 true 를
  //    돌려주면 WatchButton 의 "정원이 찼습니다" 안내가 영영 뜨지 않는다 —
  //    막으려던 바로 그 '조용한 실패'가 된다.
  //
  //    `items` 는 렌더 시점의 최신 상태이므로 여기서 바로 판단하고,
  //    상태 갱신은 그 결과를 그대로 밀어 넣기만 한다.
  const add = useCallback(
    (symbol: string): boolean => {
      if (items.some((i) => i.symbol === symbol)) return true; // 이미 있으면 성공
      if (items.length >= MAX_WATCHLIST) return false;

      const next = [...items, { symbol, addedAt: new Date().toISOString() }];
      write(next);
      setItems(next);
      return true;
    },
    [items],
  );

  const remove = useCallback(
    (symbol: string) => {
      const next = items.filter((i) => i.symbol !== symbol);
      if (next.length === items.length) return;
      write(next);
      setItems(next);
    },
    [items],
  );

  const toggle = useCallback(
    (symbol: string): boolean => {
      if (items.some((i) => i.symbol === symbol)) {
        remove(symbol);
        return false;
      }
      return add(symbol);
    },
    [items, add, remove],
  );

  return {
    items,
    ready,
    has,
    add,
    remove,
    toggle,
    isFull: items.length >= MAX_WATCHLIST,
  };
}
