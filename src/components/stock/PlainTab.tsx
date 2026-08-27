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

import type { ExplanationSet } from "@/lib/templates";
import type { PeriodDays } from "@/lib/types";

interface Props {
  explanation: ExplanationSet;
  period: PeriodDays;
  /** 위치를 계산할 수 있었는가 */
  hasPosition: boolean;
  /** 흐름을 계산할 수 있었는가 */
  hasTrend: boolean;
}

export function PlainTab({ explanation, period, hasPosition, hasTrend }: Props) {
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
          href="/"
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
