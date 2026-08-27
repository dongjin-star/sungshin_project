/**
 * 관심종목 1행 (PRD §5.6)
 *
 * 페르소나 C 의 Pain Point 가 이 컴포넌트의 존재 이유다 —
 * "증권 앱 관심종목은 등락률만 보여줘서 종목 간 비교가 안 된다.
 *  삼성전자 -1%와 소형주 -1%는 의미가 다르다."
 *
 * 그래서 등락률 옆에 **위치**를 같은 척도로 병기한다. 미니 바(0~100)는
 * 숫자를 읽지 않고도 행끼리 눈으로 비교하라고 있는 것이다.
 *
 * ⚠️ 기준 시각은 **행 단위**로 가진다 (§12.3). 리스트 상단에 일괄 시각을
 *    표시하면 KR·US 가 섞였을 때 거짓말이 된다.
 */

"use client";

import Link from "next/link";

import { formatChangeRate, formatPrice } from "@/lib/format";
import { zoneLabel } from "@/lib/indicators/zone";
import type { WatchlistItem } from "@/lib/types";

interface Props {
  item: WatchlistItem;
  editing: boolean;
  onRemove: (symbol: string) => void;
}

export function WatchlistRow({ item, editing, onRemove }: Props) {
  const body = (
    <>
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
            {item.name}
          </span>
          <TrendIcon item={item} />
        </span>

        {item.error !== undefined ? (
          <span
            style={{
              display: "block",
              marginTop: 3,
              fontSize: "0.75rem",
              color: "var(--text-subtle)",
            }}
          >
            정보를 불러오지 못했습니다
          </span>
        ) : (
          <PositionBar item={item} />
        )}
      </span>

      <span style={{ textAlign: "right", flexShrink: 0, minWidth: 84 }}>
        {item.price !== null ? (
          <>
            <span style={{ display: "block", fontSize: "0.9375rem", fontWeight: 600 }}>
              {formatPrice(item.price.current, item.currency)}
            </span>
            <span
              style={{
                display: "block",
                marginTop: 2,
                fontSize: "0.75rem",
                color:
                  item.price.changeRate > 0
                    ? "var(--up)"
                    : item.price.changeRate < 0
                      ? "var(--down)"
                      : "var(--flat)",
              }}
            >
              {formatChangeRate(item.price.changeRate)}
            </span>
          </>
        ) : (
          <span style={{ fontSize: "0.8125rem", color: "var(--text-subtle)" }}>—</span>
        )}
      </span>
    </>
  );

  return (
    <li style={{ display: "flex", alignItems: "stretch" }}>
      {editing && (
        <button
          type="button"
          onClick={() => onRemove(item.symbol)}
          aria-label={`${item.name} 관심종목에서 삭제`}
          style={{
            flexShrink: 0,
            width: 44,
            border: "none",
            borderBottom: "1px solid var(--border)",
            background: "transparent",
            color: "var(--down)",
            fontSize: "1.125rem",
            cursor: "pointer",
          }}
        >
          −
        </button>
      )}

      {editing ? (
        <span
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
            padding: "0.75rem 1rem 0.75rem 0",
            borderBottom: "1px solid var(--border)",
            minHeight: 64,
          }}
        >
          {body}
        </span>
      ) : (
        <Link
          href={`/stock/${encodeURIComponent(item.symbol)}`}
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
            padding: "0.75rem 1rem",
            borderBottom: "1px solid var(--border)",
            textDecoration: "none",
            color: "inherit",
            minHeight: 64,
          }}
        >
          {body}
        </Link>
      )}
    </li>
  );
}

/**
 * 위치 미니 바 + 구간·퍼센타일 (§5.6 UX)
 *
 * 바는 0~100 을 그대로 쓴다. 행마다 축이 달라지면 비교가 성립하지 않는다.
 */
function PositionBar({ item }: { item: WatchlistItem }) {
  const percentile = item.position?.percentile ?? null;
  const zone = item.position?.zone ?? null;

  if (percentile === null || zone === null) {
    return (
      <span
        style={{
          display: "block",
          marginTop: 3,
          fontSize: "0.75rem",
          color: "var(--text-subtle)",
        }}
      >
        {item.symbol} · 위치 계산 불가
      </span>
    );
  }

  return (
    <span style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: 5 }}>
      <span
        aria-hidden="true"
        style={{
          position: "relative",
          width: 56,
          height: 4,
          flexShrink: 0,
          borderRadius: 2,
          background: "var(--surface-strong)",
        }}
      >
        <span
          style={{
            position: "absolute",
            top: -2,
            left: `calc(${Math.max(0, Math.min(100, percentile))}% - 3px)`,
            width: 6,
            height: 8,
            borderRadius: 2,
            background: "var(--text)",
          }}
        />
      </span>
      <span
        style={{
          fontSize: "0.75rem",
          color: "var(--text-muted)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {zoneLabel(zone)} · {Math.round(percentile)}%
      </span>
    </span>
  );
}

/**
 * 배열 상태 + 교차 배지 (§5.6 정보)
 *
 * §5.4 의 표기 규칙을 따른다 — "상향 교차"가 주 표기다. 리스트에서는
 * 자리가 좁으므로 괄호 병기는 생략하고 상세 화면에 맡긴다.
 */
function TrendIcon({ item }: { item: WatchlistItem }) {
  const trend = item.trend;
  if (trend === null || trend.alignment === null) return null;

  const aligned = trend.alignment === "UP";

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem", flexShrink: 0 }}>
      <span
        title={aligned ? "정배열" : "역배열"}
        style={{
          fontSize: "0.625rem",
          fontWeight: 600,
          padding: "0.0625rem 0.3125rem",
          borderRadius: 4,
          background: "var(--surface-strong)",
          color: "var(--text-muted)",
        }}
      >
        {aligned ? "정배열" : "역배열"}
      </span>

      {trend.crossType !== null && trend.crossDaysAgo !== null && (
        <span
          style={{
            fontSize: "0.625rem",
            fontWeight: 600,
            padding: "0.0625rem 0.3125rem",
            borderRadius: 4,
            border: "1px solid var(--border)",
            color: "var(--text-muted)",
            whiteSpace: "nowrap",
          }}
        >
          {trend.crossDaysAgo === 0 ? "오늘" : `${trend.crossDaysAgo}일 전`}{" "}
          {trend.crossType === "GOLDEN" ? "상향" : "하향"}
        </span>
      )}
    </span>
  );
}
