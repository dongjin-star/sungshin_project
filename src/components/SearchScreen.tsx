"use client";

/**
 * 화면 1 — 종목 검색 (PRD §5.2)
 *
 * 상태값은 §5.2 가 지정한 6가지를 그대로 쓴다:
 *   IDLE(최근 검색어) / TYPING / RESULTS / EMPTY / INDEX_LOADING / INDEX_ERROR
 *
 * §5.2 가 못박은 UX 규칙:
 *   · IME 조합 중 Enter 무시 (`isComposing`) — 한글 검색이 주 용도
 *   · 입력 300ms 디바운스. 로컬 인덱스 조회이므로 네트워크는 없다
 *   · 초성 검색 (F-SEARCH-03)
 *   · KR/US 시장 필터 칩
 *   · 모바일 자동 포커스 안 함 (키보드가 화면을 가림)
 */

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import { DEFAULT_LIMIT, search, type SearchEntry } from "@/lib/search/match";
import { useSearchIndex } from "@/lib/search/use-index";
import { useRecentSearches } from "@/lib/search/recent";
import { resolveState, type ScreenState } from "@/lib/search/screen-state";
import { SearchResultRow } from "./SearchResultRow";
import type { Quote } from "@/lib/service/quotes";
import type { Market } from "@/lib/types";

/** §5.2 — 입력 디바운스 */
const DEBOUNCE_MS = 300;

export function SearchScreen() {
  const index = useSearchIndex();
  const recent = useRecentSearches();

  const [raw, setRaw] = useState("");
  const [query, setQuery] = useState("");
  const [market, setMarket] = useState<Market | null>(null);
  const composing = useRef(false);

  // ── 디바운스 ──────────────────────────────────────────────────────
  // 로컬 조회라 네트워크는 없지만, 15,000건 스캔이 키 입력마다 도는 것을
  // 막는다. 한글 IME 는 한 글자를 만드는 동안에도 입력 이벤트를 계속 낸다.
  useEffect(() => {
    const id = setTimeout(() => setQuery(raw), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [raw]);

  // 스캔 자체는 빠르지만(실측 1~11ms) 타이핑을 막지 않도록 낮은 우선순위로 민다
  const deferredQuery = useDeferredValue(query);

  const results = useMemo(() => {
    if (index.status !== "ready" || deferredQuery.trim().length === 0) return [];
    return search(index.entries, deferredQuery, { market, limit: DEFAULT_LIMIT });
  }, [index.status, index.entries, deferredQuery, market]);

  const quotes = useQuotes(results);

  const state = resolveState(index.status, raw, query, results.length);

  const handleSelect = useCallback(
    (entry: SearchEntry) => {
      recent.add({
        symbol: entry.symbol,
        name: entry.nameKo ?? entry.nameEn ?? entry.symbol,
        market: entry.market,
      });
    },
    [recent],
  );

  return (
    <div>
      <header style={{ padding: "1.25rem 1rem 0.75rem" }}>
        <h1 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 700, letterSpacing: "-0.01em" }}>
          종목 검색
        </h1>
        <p style={{ margin: "0.25rem 0 0", fontSize: "0.8125rem", color: "var(--text-muted)" }}>
          종목명, 초성, 티커, 종목코드로 찾을 수 있습니다.
        </p>
      </header>

      <div style={{ padding: "0 1rem 0.75rem", position: "sticky", top: 0, background: "var(--bg)", zIndex: 10 }}>
        <SearchInput
          value={raw}
          onChange={setRaw}
          composingRef={composing}
          disabled={index.status === "error"}
        />
        <MarketChips value={market} onChange={setMarket} />
      </div>

      <Body
        state={state}
        index={index}
        results={results}
        quotes={quotes}
        query={query}
        recent={recent}
        onSelect={handleSelect}
      />
    </div>
  );
}

// ── 입력 ────────────────────────────────────────────────────────────

function SearchInput({
  value,
  onChange,
  composingRef,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  composingRef: React.RefObject<boolean>;
  disabled: boolean;
}) {
  return (
    <div style={{ position: "relative" }}>
      <input
        type="search"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        // §5.2 — IME 조합 중 Enter 를 무시한다. 조합 확정 Enter 가
        // 폼 제출로 새어 나가면 한글 검색이 매번 끊긴다.
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            if (composingRef.current || e.nativeEvent.isComposing) {
              e.preventDefault();
              return;
            }
            // 결과는 이미 라이브로 갱신된다. Enter 는 키보드를 내리는 용도.
            e.currentTarget.blur();
          }
          if (e.key === "Escape") onChange("");
        }}
        placeholder="삼성전자, ㅅㅅㅈㅈ, 005930, AAPL"
        aria-label="종목 검색"
        // §5.2 — 모바일 자동 포커스 안 함 (키보드가 화면을 가림)
        autoFocus={false}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="search"
        style={{
          width: "100%",
          boxSizing: "border-box",
          padding: "0.75rem 0.875rem",
          fontSize: "1rem", // 16px 미만이면 iOS 가 화면을 확대한다
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          color: "var(--text)",
        }}
      />
    </div>
  );
}

/** §5.2 — KR/US 시장 필터 칩 */
function MarketChips({
  value,
  onChange,
}: {
  value: Market | null;
  onChange: (m: Market | null) => void;
}) {
  const options: { label: string; value: Market | null }[] = [
    { label: "전체", value: null },
    { label: "국내", value: "KR" },
    { label: "미국", value: "US" },
  ];

  return (
    <div role="group" aria-label="시장 필터" style={{ display: "flex", gap: "0.375rem", marginTop: "0.625rem" }}>
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.label}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            style={{
              padding: "0.3125rem 0.75rem",
              fontSize: "0.8125rem",
              fontWeight: active ? 600 : 400,
              borderRadius: 999,
              border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
              background: active ? "var(--accent)" : "transparent",
              color: active ? "var(--bg)" : "var(--text-muted)",
              cursor: "pointer",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ── 본문 ────────────────────────────────────────────────────────────

function Body({
  state,
  index,
  results,
  quotes,
  query,
  recent,
  onSelect,
}: {
  state: ScreenState;
  index: ReturnType<typeof useSearchIndex>;
  results: SearchEntry[];
  quotes: Map<string, Quote>;
  query: string;
  recent: ReturnType<typeof useRecentSearches>;
  onSelect: (e: SearchEntry) => void;
}) {
  if (state === "INDEX_LOADING") {
    return <Notice>종목 목록을 불러오는 중입니다.</Notice>;
  }

  if (state === "INDEX_ERROR") {
    return (
      <Notice>
        종목 목록을 불러오지 못했습니다.
        <button
          type="button"
          onClick={index.reload}
          style={{
            display: "block",
            margin: "0.75rem auto 0",
            padding: "0.5rem 1rem",
            fontSize: "0.8125rem",
            border: "1px solid var(--border)",
            borderRadius: 8,
            background: "var(--surface)",
            color: "var(--text)",
            cursor: "pointer",
          }}
        >
          다시 시도
        </button>
      </Notice>
    );
  }

  if (state === "IDLE") {
    return <RecentList recent={recent} count={index.count} />;
  }

  if (state === "TYPING") {
    // 이전 결과를 지우지 않는다. 글자마다 목록이 사라졌다 나타나면 산만하다.
    return results.length > 0 ? (
      <ResultList results={results} quotes={quotes} onSelect={onSelect} />
    ) : (
      <Notice>{" "}</Notice>
    );
  }

  if (state === "EMPTY") {
    return (
      <Notice>
        &lsquo;{query}&rsquo;에 해당하는 종목이 없습니다.
        <span style={{ display: "block", marginTop: "0.375rem", fontSize: "0.75rem", color: "var(--text-subtle)" }}>
          종목명 일부나 초성으로도 찾을 수 있습니다.
        </span>
      </Notice>
    );
  }

  return <ResultList results={results} quotes={quotes} onSelect={onSelect} />;
}

function ResultList({
  results,
  quotes,
  onSelect,
}: {
  results: SearchEntry[];
  quotes: Map<string, Quote>;
  onSelect: (e: SearchEntry) => void;
}) {
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {results.map((entry) => (
        <SearchResultRow
          key={entry.symbol}
          entry={entry}
          quote={quotes.get(entry.symbol)}
          onSelect={onSelect}
        />
      ))}
    </ul>
  );
}

/** F-SEARCH-04 — 최근 검색어 (IDLE 상태) */
function RecentList({
  recent,
  count,
}: {
  recent: ReturnType<typeof useRecentSearches>;
  count: number;
}) {
  if (recent.items.length === 0) {
    return (
      <Notice>
        찾으실 종목의 이름을 입력해 주세요.
        <span style={{ display: "block", marginTop: "0.375rem", fontSize: "0.75rem", color: "var(--text-subtle)" }}>
          {count.toLocaleString()}개 종목에서 찾습니다.
        </span>
      </Notice>
    );
  }

  return (
    <section>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0.75rem 1rem 0.5rem",
        }}
      >
        <h2 style={{ margin: 0, fontSize: "0.8125rem", fontWeight: 600, color: "var(--text-muted)" }}>
          최근 검색
        </h2>
        <button
          type="button"
          onClick={recent.clear}
          style={{
            padding: "0.25rem 0.25rem",
            fontSize: "0.75rem",
            border: "none",
            background: "none",
            color: "var(--text-subtle)",
            cursor: "pointer",
          }}
        >
          전체 삭제
        </button>
      </div>

      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {recent.items.map((item) => (
          <li
            key={item.symbol}
            style={{
              display: "flex",
              alignItems: "center",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <a
              href={`/stock/${encodeURIComponent(item.symbol)}`}
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                padding: "0.8125rem 0.5rem 0.8125rem 1rem",
                minHeight: 48,
                textDecoration: "none",
                color: "inherit",
                fontSize: "0.9375rem",
              }}
            >
              <span>{item.name}</span>
              <span style={{ fontSize: "0.75rem", color: "var(--text-subtle)" }}>
                {item.symbol}
              </span>
            </a>
            <button
              type="button"
              onClick={() => recent.remove(item.symbol)}
              aria-label={`${item.name} 최근 검색에서 삭제`}
              style={{
                padding: "0.75rem 1rem",
                border: "none",
                background: "none",
                color: "var(--text-subtle)",
                fontSize: "1rem",
                lineHeight: 1,
                cursor: "pointer",
              }}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        margin: 0,
        padding: "2.5rem 1.5rem",
        textAlign: "center",
        fontSize: "0.875rem",
        color: "var(--text-muted)",
        lineHeight: 1.6,
      }}
    >
      {children}
    </p>
  );
}

// ── 결과 시세 ───────────────────────────────────────────────────────

/**
 * 결과 목록의 현재가·등락률 (§5.2).
 *
 * "결과가 20건이면 심볼을 콤마로 묶어 **1회 호출**한다. 200건까지
 * 다건 조회가 가능하므로 결과 수에 관계없이 호출 1회로 끝난다."
 *
 * `/api/quotes` 는 캔들을 새로 받지 않는다 — 그래서 이 호출이 무거워지지
 * 않는다. 자세한 배경은 `lib/service/quotes.ts` 상단 주석 참조.
 */
function useQuotes(results: readonly SearchEntry[]): Map<string, Quote> {
  const [quotes, setQuotes] = useState<Map<string, Quote>>(new Map());
  const symbols = results.map((r) => r.symbol).join(",");

  useEffect(() => {
    if (symbols.length === 0) return;

    const controller = new AbortController();

    // 타이핑이 이어지는 동안 매 글자마다 호출하지 않는다. 결과 목록이
    // 안정된 뒤에 한 번 나가면 된다.
    const id = setTimeout(() => {
      fetch(`/api/quotes?symbols=${encodeURIComponent(symbols)}`, {
        signal: controller.signal,
      })
        .then((res) => (res.ok ? (res.json() as Promise<{ items: Quote[] }>) : null))
        .then((data) => {
          if (data === null) return;
          setQuotes(new Map(data.items.map((q) => [q.symbol, q])));
        })
        .catch(() => {
          // 시세를 못 받아도 종목 목록은 그대로 쓸 수 있다 (§12.4).
          // 행은 가격 자리에 '—' 를 보여준다.
        });
    }, 200);

    return () => {
      clearTimeout(id);
      controller.abort();
    };
  }, [symbols]);

  return quotes;
}
