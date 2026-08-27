"use client";

/**
 * 최근 검색어 (PRD F-SEARCH-04 — 로컬 저장, 최대 10건)
 *
 * §6.2 가 클라이언트 로컬 저장을 명시한 항목이다. 서버로 보내지 않는다.
 * Phase 2 에서 계정이 생겨도 검색 이력은 서버로 올리지 않는다 — 관심종목과
 * 달리 기기를 옮겨 다닐 이유가 없고, 남기지 않는 편이 낫다.
 */

import { useCallback, useEffect, useState } from "react";

import type { Market } from "../types";

const KEY = "posture.recent-searches.v1";
export const MAX_RECENT = 10;

export interface RecentItem {
  symbol: string;
  name: string;
  market: Market;
}

function read(): RecentItem[] {
  // SSR·프라이빗 모드·저장소 차단 — 어느 쪽이든 빈 목록으로 동작해야 한다
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (v): v is RecentItem =>
        typeof v === "object" && v !== null && typeof (v as RecentItem).symbol === "string",
    );
  } catch {
    return [];
  }
}

function write(items: readonly RecentItem[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    // 저장 실패가 검색을 막을 이유는 없다
  }
}

export function useRecentSearches() {
  const [items, setItems] = useState<RecentItem[]>([]);

  // localStorage 는 서버에 없다. 첫 렌더를 서버와 맞추고 나서 채운다 —
  // 아니면 hydration 불일치가 난다.
  useEffect(() => {
    setItems(read());
  }, []);

  const add = useCallback((item: RecentItem) => {
    setItems((prev) => {
      // 같은 종목을 다시 누르면 위로 올린다
      const next = [item, ...prev.filter((p) => p.symbol !== item.symbol)].slice(
        0,
        MAX_RECENT,
      );
      write(next);
      return next;
    });
  }, []);

  const remove = useCallback((symbol: string) => {
    setItems((prev) => {
      const next = prev.filter((p) => p.symbol !== symbol);
      write(next);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setItems([]);
    write([]);
  }, []);

  return { items, add, remove, clear };
}
