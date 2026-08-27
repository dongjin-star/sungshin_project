"use client";

/**
 * 검색 인덱스 로딩 (PRD D-04, §5.2 `INDEX_LOADING` / `INDEX_ERROR`)
 *
 * D-04 가 전량 클라이언트 로드를 택했으므로 진입 후 `/search-index.json`
 * 을 한 번 받는다. 실측 346KB(gzip).
 *
 * §5.2 가 요구하는 규칙 두 가지를 지킨다.
 *   · **첫 페인트를 막지 않는다.** 검색창은 즉시 그리고 인덱스는 뒤에서 받는다.
 *   · 실패를 숨기지 않는다 — `INDEX_ERROR` 를 그대로 노출해 재시도를 준다 (PP-03).
 *
 * 브라우저 HTTP 캐시가 `max-age=86400` 으로 잡아주므로 두 번째 진입부터는
 * 네트워크가 아예 나가지 않는다. 여기서 별도 저장소를 두지 않는 이유다.
 */

import { useEffect, useRef, useState } from "react";

import { toSearchEntries, type SearchEntry } from "./match";
import type { SearchIndexPayload } from "../service/search-index";

export type IndexStatus = "loading" | "ready" | "error";

export interface IndexState {
  status: IndexStatus;
  entries: SearchEntry[];
  count: number;
  syncedAt: string | null;
  reload: () => void;
}

export function useSearchIndex(): IndexState {
  const [status, setStatus] = useState<IndexStatus>("loading");
  const [entries, setEntries] = useState<SearchEntry[]>([]);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // 언마운트 후 setState 를 막는다. 인덱스가 커서 응답이 늦게 올 수 있다.
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();

    setStatus("loading");

    fetch("/search-index.json", { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<SearchIndexPayload>;
      })
      .then((payload) => {
        if (!alive.current) return;
        // 정규화는 여기서 한 번만 돈다 (실측 15,262건 ≈ 20ms)
        setEntries(toSearchEntries(payload.items));
        setSyncedAt(payload.syncedAt);
        setStatus("ready");
      })
      .catch((err: unknown) => {
        if (!alive.current) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        console.error("[search] 인덱스를 불러오지 못했다:", err);
        setStatus("error");
      });

    return () => {
      alive.current = false;
      controller.abort();
    };
  }, [attempt]);

  return {
    status,
    entries,
    count: entries.length,
    syncedAt,
    reload: () => setAttempt((n) => n + 1),
  };
}
