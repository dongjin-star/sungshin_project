/**
 * 화면 5 — 관심종목 (PRD §5.6)
 *
 * 목적: 복수 종목의 위치·추세를 **동일 척도로 나란히** 비교.
 *
 * 상태값: EMPTY / LOADING / READY / PARTIAL_ERROR
 *
 * ── 기간 토글은 리스트 전체에 일괄 적용된다 ──────────────────────
 *
 * 종목별 개별 기간 설정을 두지 않는다. 한 종목만 250일이고 나머지가
 * 120일이면 나란히 놓은 의미가 사라진다 — 비교 척도가 깨진다.
 *
 * ── 갱신 비용 ────────────────────────────────────────────────────
 *
 * 20종목이든 5종목이든 토스 호출은 `/prices` 다건 **1회**다. 과거 종가는
 * 서버 캐시에 있고 퍼센타일·MA 는 거기서 재계산된다 (§10.4).
 */

"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { WatchlistRow } from "./WatchlistRow";
import { PeriodToggle } from "../stock/PeriodToggle";
import { usePreferences } from "@/lib/preferences";
import { SORT_LABELS, sortWatchlist, type SortMode } from "@/lib/watchlist/sort";
import { MAX_WATCHLIST, useWatchlist } from "@/lib/watchlist/store";
import type { PeriodDays, WatchlistItem, WatchlistResponse } from "@/lib/types";

type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; items: WatchlistItem[] };

export function WatchlistScreen() {
  const watchlist = useWatchlist();
  const { prefs, ready: prefsReady, update } = usePreferences();

  const [state, setState] = useState<LoadState>({ status: "idle" });
  const [editing, setEditing] = useState(false);
  const [attempt, setAttempt] = useState(0);

  // 심볼 목록을 문자열로 고정해 의존성이 매 렌더 바뀌는 것을 막는다
  const symbolKey = watchlist.items.map((i) => i.symbol).join(",");
  const period = prefs.periodDays;

  // 이전 결과를 들고 있는다. 기간을 바꿀 때 리스트가 비었다가 다시
  // 그려지면 화면이 통째로 깜빡인다 — 낡은 값을 잠깐 보여주는 편이 낫다.
  const lastItems = useRef<WatchlistItem[]>([]);

  useEffect(() => {
    if (!watchlist.ready || !prefsReady) return;
    if (symbolKey.length === 0) {
      lastItems.current = [];
      setState({ status: "ready", items: [] });
      return;
    }

    const controller = new AbortController();
    let alive = true;
    setState({ status: "loading" });

    fetch(`/api/watchlist?symbols=${encodeURIComponent(symbolKey)}&period=${period}`, {
      signal: controller.signal,
    })
      .then(async (res) => {
        const body: unknown = await res.json();
        if (!res.ok) {
          const message =
            typeof body === "object" && body !== null && "error" in body
              ? ((body as { error: { message?: string } }).error.message ??
                "정보를 불러오지 못했습니다.")
              : "정보를 불러오지 못했습니다.";
          throw new Error(message);
        }
        return body as WatchlistResponse;
      })
      .then((data) => {
        if (!alive) return;
        lastItems.current = data.items;
        setState({ status: "ready", items: data.items });
      })
      .catch((err: unknown) => {
        if (!alive) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setState({
          status: "error",
          message: err instanceof Error ? err.message : "정보를 불러오지 못했습니다.",
        });
      });

    return () => {
      alive = false;
      controller.abort();
    };
  }, [symbolKey, period, watchlist.ready, prefsReady, attempt]);

  const addedAt = useMemo(
    () => new Map(watchlist.items.map((i) => [i.symbol, i.addedAt])),
    [watchlist.items],
  );

  const shown = state.status === "ready" ? state.items : lastItems.current;
  const sorted = useMemo(
    () => sortWatchlist(shown, prefs.watchlistSort, addedAt),
    [shown, prefs.watchlistSort, addedAt],
  );

  const failed = sorted.filter((i) => i.error !== undefined).length;

  const cycleSort = useCallback(
    (mode: SortMode) => {
      const current = prefs.watchlistSort;
      // 같은 기준을 다시 누르면 방향이 뒤집힌다 (F-WATCH-03 위치 오름/내림)
      update({
        watchlistSort:
          current.mode === mode
            ? { mode, order: current.order === "asc" ? "desc" : "asc" }
            : { mode, order: mode === "position" ? "desc" : "asc" },
      });
    },
    [prefs.watchlistSort, update],
  );

  return (
    <div>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "1rem",
          padding: "1.25rem 1rem 0.75rem",
        }}
      >
        <h1 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 700, letterSpacing: "-0.01em" }}>
          관심종목
          <span
            style={{
              marginLeft: "0.375rem",
              fontSize: "0.8125rem",
              fontWeight: 500,
              color: "var(--text-subtle)",
            }}
          >
            {watchlist.items.length}/{MAX_WATCHLIST}
          </span>
        </h1>

        <span style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
          {watchlist.items.length > 0 && (
            <button
              type="button"
              onClick={() => setEditing((v) => !v)}
              style={{
                padding: "0.375rem 0.625rem",
                border: "none",
                borderRadius: 8,
                background: editing ? "var(--surface-strong)" : "transparent",
                color: "var(--text-muted)",
                fontSize: "0.8125rem",
                cursor: "pointer",
                minHeight: 36,
              }}
            >
              {editing ? "완료" : "편집"}
            </button>
          )}
          <Link
            href="/search"
            aria-label="종목 검색"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 36,
              height: 36,
              borderRadius: 8,
              textDecoration: "none",
              color: "var(--text-muted)",
              fontSize: "1rem",
            }}
          >
            🔍
          </Link>
        </span>
      </header>

      {watchlist.ready && watchlist.items.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <div style={{ padding: "0 1rem 0.75rem" }}>
            <PeriodToggle
              value={period}
              onChange={(p: PeriodDays) => update({ periodDays: p })}
            />
            <p
              style={{
                margin: "0.5rem 0 0",
                fontSize: "0.6875rem",
                color: "var(--text-subtle)",
              }}
            >
              기간은 리스트 전체에 함께 적용됩니다. 종목마다 다른 기간을 쓰면 나란히 비교할 수
              없습니다.
            </p>
          </div>

          <div
            style={{
              display: "flex",
              gap: "0.375rem",
              padding: "0 1rem 0.75rem",
            }}
          >
            {(Object.keys(SORT_LABELS) as SortMode[]).map((mode) => {
              const active = prefs.watchlistSort.mode === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  onClick={() => cycleSort(mode)}
                  aria-pressed={active}
                  style={{
                    padding: "0.3125rem 0.625rem",
                    border: "1px solid var(--border)",
                    borderRadius: 999,
                    background: active ? "var(--surface-strong)" : "transparent",
                    color: active ? "var(--text)" : "var(--text-muted)",
                    fontSize: "0.75rem",
                    fontWeight: active ? 600 : 500,
                    cursor: "pointer",
                    minHeight: 32,
                  }}
                >
                  {SORT_LABELS[mode]}
                  {active && (prefs.watchlistSort.order === "asc" ? " ↑" : " ↓")}
                </button>
              );
            })}
          </div>

          {/* PARTIAL_ERROR — 실패한 행만 알리고 전체를 에러로 만들지 않는다 (§12.4) */}
          {failed > 0 && (
            <p
              style={{
                margin: "0 1rem 0.75rem",
                padding: "0.625rem 0.75rem",
                background: "var(--surface)",
                borderRadius: 8,
                fontSize: "0.75rem",
                color: "var(--text-muted)",
              }}
            >
              {failed}개 종목의 정보를 불러오지 못했습니다. 나머지는 정상입니다.
            </p>
          )}

          {state.status === "error" && shown.length === 0 ? (
            <ErrorState message={state.message} onRetry={() => setAttempt((n) => n + 1)} />
          ) : state.status === "loading" && shown.length === 0 ? (
            <Skeleton count={Math.max(1, watchlist.items.length)} />
          ) : (
            <ul
              style={{
                listStyle: "none",
                margin: 0,
                padding: 0,
                // 갱신 중에는 낡은 값이라는 것을 드러낸다 (PP-03)
                opacity: state.status === "loading" ? 0.55 : 1,
                transition: "opacity 150ms",
              }}
            >
              {sorted.map((item) => (
                <WatchlistRow
                  key={item.symbol}
                  item={item}
                  editing={editing}
                  onRemove={watchlist.remove}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div style={{ padding: "2.5rem 1.5rem", textAlign: "center" }}>
      <p style={{ margin: 0, fontSize: "0.9375rem", fontWeight: 600 }}>
        아직 담은 종목이 없습니다
      </p>
      <p
        style={{
          margin: "0.5rem 0 1.5rem",
          fontSize: "0.8125rem",
          color: "var(--text-muted)",
          lineHeight: 1.6,
        }}
      >
        종목을 담아두면 위치와 흐름을 같은 기준으로 나란히 볼 수 있습니다.
      </p>
      <Link
        href="/search"
        style={{
          display: "inline-block",
          padding: "0.75rem 1.25rem",
          borderRadius: 10,
          background: "var(--accent)",
          color: "var(--bg)",
          fontSize: "0.875rem",
          fontWeight: 600,
          textDecoration: "none",
        }}
      >
        종목 검색하기
      </Link>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div style={{ padding: "1rem" }}>
      <div
        style={{
          padding: "1rem",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 10,
        }}
      >
        <div style={{ fontSize: "0.875rem", fontWeight: 600 }}>{message}</div>
        <button
          type="button"
          onClick={onRetry}
          style={{
            marginTop: "0.75rem",
            padding: "0.5rem 0.875rem",
            border: "1px solid var(--border)",
            borderRadius: 8,
            background: "var(--bg)",
            fontSize: "0.8125rem",
            cursor: "pointer",
          }}
        >
          다시 시도
        </button>
      </div>
    </div>
  );
}

function Skeleton({ count }: { count: number }) {
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0 }} aria-busy="true">
      {Array.from({ length: Math.min(count, 8) }, (_, i) => (
        <li
          key={i}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
            padding: "0.75rem 1rem",
            borderBottom: "1px solid var(--border)",
            minHeight: 64,
          }}
        >
          <span style={{ flex: 1 }}>
            <span
              style={{
                display: "block",
                width: "40%",
                height: 14,
                background: "var(--surface)",
                borderRadius: 4,
              }}
            />
            <span
              style={{
                display: "block",
                width: "60%",
                height: 10,
                marginTop: 8,
                background: "var(--surface)",
                borderRadius: 4,
              }}
            />
          </span>
          <span
            style={{ width: 64, height: 14, background: "var(--surface)", borderRadius: 4 }}
          />
        </li>
      ))}
    </ul>
  );
}
