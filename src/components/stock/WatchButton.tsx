/**
 * 관심종목 추가·삭제 (PRD F-WATCH-01, §5.3 CTA)
 *
 * 정원(20종목)이 찼을 때 **조용히 실패하지 않는다.** 눌렀는데 아무 일도
 * 일어나지 않으면 사용자는 앱이 고장난 줄 안다 (PP-03).
 */

"use client";

import { useEffect, useState } from "react";

import { MAX_WATCHLIST, useWatchlist } from "@/lib/watchlist/store";

export function WatchButton({ symbol, name }: { symbol: string; name: string }) {
  const watchlist = useWatchlist();
  const [full, setFull] = useState(false);

  const watched = watchlist.has(symbol);

  // 정원 안내는 잠깐만 띄운다. 계속 남아 있으면 화면을 가린다.
  useEffect(() => {
    if (!full) return;
    const id = setTimeout(() => setFull(false), 4_000);
    return () => clearTimeout(id);
  }, [full]);

  // localStorage 를 읽기 전에는 상태를 단정하지 않는다 — 담긴 종목인데
  // 빈 하트가 잠깐 보였다가 채워지면 눈에 띈다.
  if (!watchlist.ready) {
    return <span style={{ width: 40, height: 40, flexShrink: 0 }} aria-hidden="true" />;
  }

  return (
    <span style={{ position: "relative", flexShrink: 0 }}>
      <button
        type="button"
        onClick={() => {
          if (watched) {
            watchlist.remove(symbol);
            return;
          }
          if (!watchlist.add(symbol)) setFull(true);
        }}
        aria-pressed={watched}
        aria-label={
          watched ? `${name} 관심종목에서 빼기` : `${name} 관심종목에 담기`
        }
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 40,
          height: 40,
          border: "none",
          borderRadius: 10,
          background: "transparent",
          fontSize: "1.25rem",
          lineHeight: 1,
          cursor: "pointer",
        }}
      >
        {watched ? "♥" : "♡"}
      </button>

      {full && (
        <span
          role="status"
          style={{
            position: "absolute",
            top: "100%",
            right: 0,
            zIndex: 20,
            marginTop: 4,
            padding: "0.5rem 0.625rem",
            width: "max-content",
            maxWidth: 220,
            background: "var(--text)",
            color: "var(--bg)",
            borderRadius: 8,
            fontSize: "0.75rem",
            lineHeight: 1.5,
          }}
        >
          관심종목은 {MAX_WATCHLIST}개까지 담을 수 있습니다. 먼저 다른 종목을 빼주세요.
        </span>
      )}
    </span>
  );
}
