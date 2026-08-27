/**
 * 검색 결과 1행 (PRD §5.2 — 종목명·티커·시장 배지·현재가·등락률)
 */

import Link from "next/link";

import { formatChangeRate, formatPrice } from "@/lib/format";
import type { Quote } from "@/lib/service/quotes";
import type { SearchEntry } from "@/lib/search/match";

interface Props {
  entry: SearchEntry;
  quote: Quote | undefined;
  onSelect: (entry: SearchEntry) => void;
}

/** 등락률 색. §5.1 이 인정한 유일한 의미색이다 */
function changeColor(rate: number): string {
  if (rate > 0) return "var(--up)";
  if (rate < 0) return "var(--down)";
  return "var(--flat)";
}

export function SearchResultRow({ entry, quote, onSelect }: Props) {
  const name = entry.nameKo ?? entry.nameEn ?? entry.symbol;
  // 한글명이 있으면 영문명을 보조로 보여준다. 둘이 같으면 중복이라 숨긴다.
  const sub = entry.nameKo !== null && entry.nameEn !== null ? entry.nameEn : null;

  return (
    <li>
      <Link
        href={`/stock/${encodeURIComponent(entry.symbol)}`}
        onClick={() => onSelect(entry)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          padding: "0.875rem 1rem",
          borderBottom: "1px solid var(--border)",
          textDecoration: "none",
          color: "inherit",
          // 터치 타깃 최소 높이
          minHeight: 60,
        }}
      >
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
            <span
              style={{
                fontSize: "0.9375rem",
                fontWeight: 600,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {name}
            </span>
            <MarketBadge market={entry.market} />
          </span>

          <span
            style={{
              display: "block",
              marginTop: 2,
              fontSize: "0.75rem",
              color: "var(--text-subtle)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {entry.symbol}
            {sub !== null && ` · ${sub}`}
          </span>
        </span>

        <span style={{ textAlign: "right", flexShrink: 0 }}>
          {quote?.price != null ? (
            <>
              <span style={{ display: "block", fontSize: "0.9375rem", fontWeight: 600 }}>
                {formatPrice(quote.price, quote.currency)}
              </span>
              {quote.changeRate !== null && (
                <span
                  style={{
                    display: "block",
                    marginTop: 2,
                    fontSize: "0.75rem",
                    color: changeColor(quote.changeRate),
                  }}
                >
                  {formatChangeRate(quote.changeRate)}
                </span>
              )}
            </>
          ) : (
            // 시세를 아직 못 받았거나 실패한 경우. 종목은 그대로 선택할 수 있다.
            <span style={{ fontSize: "0.8125rem", color: "var(--text-subtle)" }}>—</span>
          )}
        </span>
      </Link>
    </li>
  );
}

function MarketBadge({ market }: { market: "KR" | "US" }) {
  return (
    <span
      style={{
        flexShrink: 0,
        fontSize: "0.625rem",
        fontWeight: 600,
        letterSpacing: "0.02em",
        padding: "0.0625rem 0.3125rem",
        borderRadius: 4,
        background: "var(--surface-strong)",
        color: "var(--text-muted)",
      }}
    >
      {market}
    </span>
  );
}
