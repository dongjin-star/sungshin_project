/**
 * 종목 상세 셸 (PRD §5.3~§5.5)
 *
 * 화면 2·3·4 는 **같은 응답 하나**를 나눠 본다. 계약 확장 E-01 이 세 기간의
 * 위치·추세·문장을 한 번에 내려주므로, 탭 전환도 기간 토글도 네트워크가
 * 나가지 않는 순수 렌더다 (§14.2 — 기간 토글 반영 100ms 이내).
 *
 * 이 컴포넌트가 지는 책임은 셋뿐이다.
 *   · 응답을 한 번 받아온다 (LOADING / ERROR)
 *   · 탭과 기간이라는 두 상태를 소유한다
 *   · 거래 상태(§12.1 HALTED)를 판정해 각 탭에 내려준다
 */

"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { PlainTab } from "./PlainTab";
import { PositionTab } from "./PositionTab";
import { TrendTab } from "./TrendTab";
import { formatAsOf, formatChangeRate, formatPrice } from "@/lib/format";
import {
  DEFAULT_PERIOD,
  type PeriodDays,
  type StockAnalysisResponse,
} from "@/lib/types";

type TabId = "position" | "trend" | "plain";

const TABS: { id: TabId; label: string }[] = [
  { id: "position", label: "위치" },
  { id: "trend", label: "흐름" },
  { id: "plain", label: "쉬운 설명" },
];

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: StockAnalysisResponse };

export function StockScreen({ symbol }: { symbol: string }) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [tab, setTab] = useState<TabId>("position");
  const [period, setPeriod] = useState<PeriodDays>(DEFAULT_PERIOD);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    setState({ status: "loading" });

    fetch(`/api/stock/${encodeURIComponent(symbol)}?period=${period}`, {
      signal: controller.signal,
    })
      .then(async (res) => {
        const body: unknown = await res.json();
        if (!res.ok) {
          const message =
            typeof body === "object" &&
            body !== null &&
            "error" in body &&
            typeof (body as { error: { message?: unknown } }).error.message === "string"
              ? (body as { error: { message: string } }).error.message
              : "정보를 불러오지 못했습니다.";
          throw new Error(message);
        }
        return body as StockAnalysisResponse;
      })
      .then((data) => {
        if (!alive) return;
        setState({ status: "ready", data });
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
    // period 는 응답의 selectedPeriod 만 바꿀 뿐 세 기간이 전부 들어 있다.
    // 재요청 대상이 아니므로 의존성에서 뺀다 — 넣으면 토글마다 네트워크가 나간다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  if (state.status === "loading") return <Shell symbol={symbol}><Skeleton /></Shell>;

  if (state.status === "error") {
    return (
      <Shell symbol={symbol}>
        <div style={{ padding: "1rem" }}>
          <div
            style={{
              padding: "1rem",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 10,
            }}
          >
            <div style={{ fontSize: "0.875rem", fontWeight: 600 }}>{state.message}</div>
            <button
              type="button"
              onClick={retry}
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
      </Shell>
    );
  }

  const { data } = state;

  // §12.1 — 거래정지·정리매매는 계산 자체를 막는다
  const blocking = data.warnings.find((w) => w.blocksAnalysis) ?? null;
  const haltedLabel = blocking?.label ?? null;

  const position = data.positions[period];
  const explanation = data.explanations[period];

  return (
    <Shell symbol={symbol}>
      <Header data={data} />

      {/* 매수 유의사항 배지 (§5.3 ⑧) — 계산을 막지 않는 것도 사실대로 알린다 */}
      {data.warnings.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.375rem", padding: "0 1rem 0.75rem" }}>
          {data.warnings.map((w) => (
            <span
              key={w.code}
              style={{
                fontSize: "0.6875rem",
                fontWeight: 600,
                padding: "0.1875rem 0.4375rem",
                borderRadius: 5,
                background: "var(--surface-strong)",
                color: "var(--text-muted)",
              }}
            >
              {w.label}
            </span>
          ))}
        </div>
      )}

      <nav
        role="tablist"
        aria-label="종목 정보"
        style={{
          display: "flex",
          borderBottom: "1px solid var(--border)",
          margin: "0 0 1rem",
        }}
      >
        {TABS.map((t) => {
          const selected = t.id === tab;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setTab(t.id)}
              style={{
                flex: 1,
                padding: "0.75rem 0",
                border: "none",
                borderBottom: selected ? "2px solid var(--accent)" : "2px solid transparent",
                background: "transparent",
                color: selected ? "var(--text)" : "var(--text-muted)",
                fontSize: "0.875rem",
                fontWeight: selected ? 600 : 500,
                cursor: "pointer",
                minHeight: 44,
              }}
            >
              {t.label}
            </button>
          );
        })}
      </nav>

      {tab === "position" && (
        <PositionTab
          position={position}
          explanation={explanation}
          currency={data.currency}
          period={period}
          onPeriodChange={setPeriod}
          haltedLabel={haltedLabel}
        />
      )}

      {tab === "trend" && (
        <TrendTab
          trend={data.trend}
          explanation={explanation}
          currency={data.currency}
          haltedLabel={haltedLabel}
        />
      )}

      {tab === "plain" && (
        <PlainTab
          explanation={explanation}
          period={position.periodDays}
          hasPosition={haltedLabel === null && position.available}
          hasTrend={haltedLabel === null && data.trend.available}
        />
      )}

      {/* §5.1 — 데이터 기준 시각 상시 표시 (PP-03) */}
      <p
        style={{
          margin: "1.5rem 1rem 0",
          fontSize: "0.6875rem",
          color: "var(--text-subtle)",
          lineHeight: 1.6,
        }}
      >
        가격 {formatAsOf(data.price.asOf)} 기준
        {data.price.isRealtime ? " (장중)" : ""} · 일봉 {data.dataAsOf}까지
      </p>
    </Shell>
  );
}

function Header({ data }: { data: StockAnalysisResponse }) {
  const rate = data.price.changeRate;
  const color = rate > 0 ? "var(--up)" : rate < 0 ? "var(--down)" : "var(--flat)";

  return (
    <header style={{ padding: "0.5rem 1rem 1rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
        <h1 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 700, letterSpacing: "-0.01em" }}>
          {data.name}
        </h1>
        <span
          style={{
            fontSize: "0.625rem",
            fontWeight: 600,
            padding: "0.0625rem 0.3125rem",
            borderRadius: 4,
            background: "var(--surface-strong)",
            color: "var(--text-muted)",
          }}
        >
          {data.market}
        </span>
      </div>

      <div style={{ marginTop: 2, fontSize: "0.75rem", color: "var(--text-subtle)" }}>
        {data.symbol}
        {data.price.marketState === "OPEN"
          ? " · 장중"
          : data.price.marketState === "HOLIDAY"
            ? " · 휴장"
            : " · 장 마감"}
      </div>

      <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem", marginTop: "0.625rem" }}>
        <span style={{ fontSize: "1.5rem", fontWeight: 700, letterSpacing: "-0.02em" }}>
          {formatPrice(data.price.current, data.currency)}
        </span>
        <span style={{ fontSize: "0.875rem", fontWeight: 600, color }}>
          {formatChangeRate(rate)}
        </span>
      </div>
    </header>
  );
}

function Shell({ symbol, children }: { symbol: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ padding: "1.25rem 1rem 0" }}>
        <Link
          href="/"
          style={{ fontSize: "0.8125rem", color: "var(--text-muted)", textDecoration: "none" }}
        >
          ← 검색으로
        </Link>
        <span className="sr-only">{symbol}</span>
      </div>
      {children}
    </div>
  );
}

/** 첫 페인트를 비워두지 않는다. 레이아웃이 흔들리지 않도록 실제 높이를 잡아둔다 */
function Skeleton() {
  return (
    <div style={{ padding: "1rem" }} aria-busy="true" aria-label="불러오는 중">
      <div style={{ height: 28, width: "45%", background: "var(--surface)", borderRadius: 6 }} />
      <div style={{ height: 16, width: "30%", background: "var(--surface)", borderRadius: 6, marginTop: 10 }} />
      <div style={{ height: 36, width: "60%", background: "var(--surface)", borderRadius: 6, marginTop: 14 }} />
      <div style={{ height: 240, background: "var(--surface)", borderRadius: 10, marginTop: 24 }} />
    </div>
  );
}
