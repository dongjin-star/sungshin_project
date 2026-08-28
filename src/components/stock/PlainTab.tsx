/**
 * 화면 4 — 쉬운 설명 (PRD §5.5)
 *
 * 목적: 화면 2·3 의 수치를 문장으로 재진술. 수치를 읽지 못하는 사용자를
 * 위한 **최종 안전망**이다.
 *
 * ── PP-05 를 레이아웃으로 강제한다 ────────────────────────────────
 *
 * §5.5 의 금지 예시:
 *   "최근 범위에서 낮은 위치이며, 단기 이동평균선이 상향 돌파했습니다."
 *
 * `~이며` 로 두 사실을 잇는 순간 종합 판정이 된다. 그래서 위치 문장과 추세
 * 문장을 **접속사로 잇지 않고, 시각적 구분선을 사이에 둔 별도 블록**으로
 * 나열한다. 데이터 구조부터 `position` / `trend` 로 갈라져 있어(templates.ts)
 * 한 배열에 섞어 넣는 코드를 쓰기 어렵게 돼 있다 — 이 컴포넌트는 그 구조를
 * 화면까지 그대로 이어받는다.
 *
 * 상태값: READY / PARTIAL (일부 지표만 계산 가능) / UNAVAILABLE
 */

"use client";

import Link from "next/link";
import { useState } from "react";

import type { ExplanationSet } from "@/lib/templates";
import type { PeriodDays, PlainExplanationResponse } from "@/lib/types";

interface Props {
  symbol: string;
  explanation: ExplanationSet;
  period: PeriodDays;
  /** 위치를 계산할 수 있었는가 */
  hasPosition: boolean;
  /** 흐름을 계산할 수 있었는가 */
  hasTrend: boolean;
}

export function PlainTab({ symbol, explanation, period, hasPosition, hasTrend }: Props) {
  if (!hasPosition && !hasTrend) {
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
          <div style={{ fontSize: "0.875rem", fontWeight: 600 }}>설명할 수 있는 것이 없습니다</div>
          <p
            style={{
              margin: "0.375rem 0 0",
              fontSize: "0.8125rem",
              color: "var(--text-muted)",
              lineHeight: 1.6,
            }}
          >
            위치와 흐름 모두 계산에 필요한 가격 자료가 부족합니다.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: "0 1rem" }}>
      <p
        style={{
          margin: "0 0 1rem",
          fontSize: "0.75rem",
          color: "var(--text-subtle)",
        }}
      >
        최근 {period}거래일 기준
      </p>

      {/* 위치 — 하나의 사실 덩어리 */}
      {hasPosition && <Statements lines={explanation.position} />}

      {/* 두 사실 사이의 벽. 이 구분선이 PP-05 의 실체다 */}
      {hasPosition && hasTrend && (
        <div
          aria-hidden="true"
          style={{ height: 1, background: "var(--border)", margin: "1rem 0" }}
        />
      )}

      {/* 흐름 — 또 하나의 사실 덩어리 */}
      {hasTrend && <Statements lines={explanation.trend} />}

      <AiDetail symbol={symbol} period={period} hasPosition={hasPosition} hasTrend={hasTrend} />

      {/* 계산하지 못한 쪽이 있으면 침묵하지 않는다 (PP-03) */}
      {(!hasPosition || !hasTrend) && (
        <p
          style={{
            margin: "1rem 0 0",
            fontSize: "0.75rem",
            color: "var(--text-subtle)",
            lineHeight: 1.6,
          }}
        >
          {!hasPosition ? "위치는" : "흐름은"} 가격 자료가 부족해 계산하지 못했습니다.
        </p>
      )}

      <div style={{ marginTop: "1.75rem" }}>
        <Link
          href="/search"
          style={{
            display: "block",
            padding: "0.8125rem",
            textAlign: "center",
            background: "var(--surface)",
            borderRadius: 10,
            fontSize: "0.8125rem",
            fontWeight: 600,
            color: "var(--text-muted)",
            textDecoration: "none",
          }}
        >
          다른 종목 검색
        </Link>
      </div>
    </div>
  );
}

type AiState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; result: PlainExplanationResponse };

/**
 * AI(Gemini) 부연 설명 — D-04.
 *
 * 위의 규칙 기반 문장(§5.5, §13.2 린트 통과 보장)은 그대로 두고, 그 아래
 * 접었다 펼치는 섹션으로만 존재한다. 사용자가 직접 펼쳐야 요청이 나간다 —
 * 자동으로 불러오지 않는다(비용·PP-05 원칙 둘 다 이유).
 *
 * 위치 설명과 흐름 설명은 여기서도 각자 다른 카드로 나눈다 — 서버가
 * 하나의 결론으로 합치지 않게 프롬프트로 강제하지만(§13.2), 화면에서도
 * 시각적으로 분리해 PP-05 의 취지를 이어간다.
 */
function AiDetail({
  symbol,
  period,
  hasPosition,
  hasTrend,
}: {
  symbol: string;
  period: PeriodDays;
  hasPosition: boolean;
  hasTrend: boolean;
}) {
  const [state, setState] = useState<AiState>({ status: "idle" });

  if (!hasPosition && !hasTrend) return null;

  const load = () => {
    setState({ status: "loading" });
    fetch(`/api/stock/${encodeURIComponent(symbol)}/explain?period=${period}`)
      .then(async (res) => {
        const body: unknown = await res.json();
        if (!res.ok) {
          const message =
            typeof body === "object" && body !== null && "error" in body
              ? ((body as { error: { message?: string } }).error.message ??
                "AI 설명을 지금은 만들 수 없습니다.")
              : "AI 설명을 지금은 만들 수 없습니다.";
          throw new Error(message);
        }
        return body as PlainExplanationResponse;
      })
      .then((result) => setState({ status: "ready", result }))
      .catch((err: unknown) => {
        setState({
          status: "error",
          message: err instanceof Error ? err.message : "AI 설명을 지금은 만들 수 없습니다.",
        });
      });
  };

  return (
    <div style={{ marginTop: "1rem" }}>
      {state.status === "idle" && (
        <button
          type="button"
          onClick={load}
          style={{
            width: "100%",
            padding: "0.75rem",
            border: "1px dashed var(--border)",
            borderRadius: 10,
            background: "transparent",
            color: "var(--text-muted)",
            fontSize: "0.8125rem",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          AI 설명 더 보기
        </button>
      )}

      {state.status === "loading" && (
        <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--text-subtle)" }}>
          AI가 설명을 만드는 중…
        </p>
      )}

      {state.status === "error" && (
        <div>
          <p style={{ margin: "0 0 0.5rem", fontSize: "0.8125rem", color: "var(--text-subtle)" }}>
            {state.message}
          </p>
          <button
            type="button"
            onClick={load}
            style={{
              padding: "0.5rem 0.875rem",
              border: "1px solid var(--border)",
              borderRadius: 8,
              background: "var(--bg)",
              color: "var(--text-muted)",
              fontSize: "0.75rem",
              cursor: "pointer",
            }}
          >
            다시 시도
          </button>
        </div>
      )}

      {state.status === "ready" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.625rem" }}>
          {state.result.positionDetail !== null && (
            <AiCard title="위치, 조금 더 자세히" text={state.result.positionDetail} />
          )}
          {state.result.trendDetail !== null && (
            <AiCard title="흐름, 조금 더 자세히" text={state.result.trendDetail} />
          )}
        </div>
      )}
    </div>
  );
}

function AiCard({ title, text }: { title: string; text: string }) {
  return (
    <div
      style={{
        padding: "0.875rem",
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 10,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.375rem",
          marginBottom: "0.375rem",
        }}
      >
        <span
          style={{
            fontSize: "0.625rem",
            fontWeight: 700,
            padding: "0.0625rem 0.375rem",
            borderRadius: 999,
            background: "var(--surface-strong)",
            color: "var(--text-muted)",
          }}
        >
          AI
        </span>
        <span style={{ fontSize: "0.8125rem", fontWeight: 600 }}>{title}</span>
      </div>
      <p style={{ margin: 0, fontSize: "0.875rem", lineHeight: 1.65, color: "var(--text)" }}>
        {text}
      </p>
    </div>
  );
}

/**
 * 문장 나열. §5.5 는 문장당 1줄, 최대 4줄, 본문보다 1단계 큰 폰트를 요구한다.
 */
function Statements({ lines }: { lines: readonly string[] }) {
  return (
    <div>
      {lines.slice(0, 4).map((line) => (
        <p
          key={line}
          style={{
            margin: "0 0 0.625rem",
            fontSize: "1rem",
            lineHeight: 1.6,
            letterSpacing: "-0.01em",
          }}
        >
          {line}
        </p>
      ))}
    </div>
  );
}
