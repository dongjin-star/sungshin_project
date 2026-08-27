/**
 * 화면 3 — 흐름 (PRD §5.4)
 *
 * 목적: 단기 흐름과 장기 흐름의 관계, 그리고 최근 교차 여부.
 *
 * §5.4 가 못박은 표기 규칙들을 지킨다.
 *   · **"상향 교차 / 하향 교차"가 주 표기**, (골든크로스) 는 괄호 병기.
 *     "골든"은 그 자체로 긍정 가치를 담은 단어다 — 중립을 표방하는 앱이
 *     지표 이름에 가치판단을 담는 것은 일관되지 않는다.
 *   · **MA 원값은 기본 접힘.** 71,240원이라는 숫자는 초보자에게 의미가 없다.
 *   · 교차가 없으면 배지 영역을 **숨긴다** (빈 카드 금지).
 *
 * ── 기간 토글이 미니 차트에도 적용된다 ─────────────────────────────
 *
 * 정배열/역배열·이격률·교차는 기간과 무관하게 항상 MA20 vs MA60 하나의
 * 사실이다. 하지만 §5.4-a 미니 차트가 "몇 거래일을 보여줄지"는 별개의
 * 질문이다 — 같은 두 선의 관계를 60일 창으로 보면 최근 교차 하나만
 * 보이고, 250일 창으로 보면 그 교차가 긴 추세 속 어디에 있었는지가
 * 보인다. 화면 2 와 같은 `PeriodToggle` 을 여기서도 그대로 재사용해
 * 이 둘을 같은 조작 하나로 넘나들 수 있게 한다.
 */

"use client";

import { useState } from "react";

import { InfoButton, InfoRow, InfoSheet } from "./InfoSheet";
import { MaChart, MaLegend } from "./MaChart";
import { PeriodToggle } from "./PeriodToggle";
import { formatDateKo, formatGapRatio, formatPrice } from "@/lib/format";
import type { Currency, PeriodDays, TrendBlock } from "@/lib/types";
import type { ExplanationSet } from "@/lib/templates";

interface Props {
  trend: TrendBlock;
  explanation: ExplanationSet;
  currency: Currency;
  haltedLabel: string | null;
  period: PeriodDays;
  onPeriodChange: (period: PeriodDays) => void;
}

export function TrendTab({
  trend,
  explanation,
  currency,
  haltedLabel,
  period,
  onPeriodChange,
}: Props) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  if (haltedLabel !== null) {
    return (
      <div style={{ padding: "1rem" }}>
        <Card
          title={`${haltedLabel} 종목입니다`}
          body="거래가 정상적으로 이루어지지 않는 기간의 가격으로는 흐름을 계산하지 않습니다."
        />
      </div>
    );
  }

  if (!trend.available || trend.alignment === null) {
    return (
      <div style={{ padding: "1rem" }}>
        <Card
          title="흐름을 계산할 수 없습니다"
          body="60일 평균선을 그리려면 최소 60거래일치 가격 자료가 필요합니다."
        />
      </div>
    );
  }

  const aligned = trend.alignment === "UP";
  const series = trend.maSeries[period];

  return (
    <div style={{ padding: "0 1rem" }}>
      <PeriodToggle value={period} onChange={onPeriodChange} />

      {/* ① 배열 상태 — 항상 값이 존재한다 (F-TREND-02) */}
      <div style={{ textAlign: "center", padding: "0.5rem 0 1rem" }}>
        <div style={{ fontSize: "1.5rem", fontWeight: 700, letterSpacing: "-0.02em" }}>
          {aligned ? "정배열" : "역배열"}
        </div>
        <div style={{ marginTop: "0.25rem", fontSize: "0.8125rem", color: "var(--text-muted)" }}>
          20일 평균이 60일 평균보다 {aligned ? "높습니다" : "낮습니다"}
        </div>
      </div>

      {/* ② 교차 배지 — 있을 때만 (빈 카드 금지) */}
      {trend.cross !== null && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            padding: "0.75rem 0.875rem",
            marginBottom: "0.75rem",
            background: "var(--surface)",
            borderRadius: 10,
          }}
        >
          <span style={{ fontSize: "0.8125rem", fontWeight: 600 }}>
            {trend.cross.daysAgo === 0 ? "오늘" : `${trend.cross.daysAgo}거래일 전`}{" "}
            {trend.cross.type === "GOLDEN" ? "상향 교차" : "하향 교차"}
          </span>
          <span style={{ fontSize: "0.75rem", color: "var(--text-subtle)" }}>
            ({trend.cross.type === "GOLDEN" ? "골든크로스" : "데드크로스"})
          </span>
          {!trend.cross.volumeConfirmed && (
            <span
              style={{
                marginLeft: "auto",
                fontSize: "0.625rem",
                padding: "0.125rem 0.375rem",
                borderRadius: 4,
                background: "var(--surface-strong)",
                color: "var(--text-muted)",
                whiteSpace: "nowrap",
              }}
            >
              거래량 미확인
            </span>
          )}
        </div>
      )}

      {/* ③ 두 선의 상대 위치 (§5.4-a) — 창 길이가 기간 토글을 따라간다 */}
      <div style={{ padding: "0.875rem", background: "var(--surface)", borderRadius: 10 }}>
        <MaChart series={series} cross={trend.cross} />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginTop: "0.625rem",
          }}
        >
          <MaLegend />
          <span style={{ fontSize: "0.6875rem", color: "var(--text-subtle)" }}>
            최근 {period}거래일
          </span>
        </div>
      </div>

      {/* ④ 이격률 */}
      {trend.gapRatio !== null && (
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            marginTop: "0.75rem",
            padding: "0.75rem 0.875rem",
            background: "var(--surface)",
            borderRadius: 10,
          }}
        >
          <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
            두 평균선의 벌어진 정도
          </span>
          <span style={{ fontSize: "0.875rem", fontWeight: 600 }}>
            {formatGapRatio(trend.gapRatio)}
          </span>
        </div>
      )}

      {/* MA 원값 — 기본 접힘 (§5.4 UX) */}
      <button
        type="button"
        onClick={() => setShowRaw((v) => !v)}
        aria-expanded={showRaw}
        style={{
          width: "100%",
          marginTop: "0.5rem",
          marginBottom: showRaw ? "0.5rem" : 0,
          padding: "0.625rem",
          border: "none",
          borderRadius: 8,
          background: "transparent",
          color: "var(--text-subtle)",
          fontSize: "0.75rem",
          cursor: "pointer",
        }}
      >
        {showRaw ? "자세히 접기" : "자세히"}
      </button>

      {showRaw && trend.maShort !== null && trend.maLong !== null && (
        <div style={{ display: "flex", gap: "0.5rem" }}>
          {[
            { label: "20일 평균", value: trend.maShort },
            { label: "60일 평균", value: trend.maLong },
          ].map((item) => (
            <div
              key={item.label}
              style={{
                flex: 1,
                padding: "0.75rem",
                background: "var(--surface)",
                borderRadius: 10,
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: "0.6875rem", color: "var(--text-subtle)" }}>{item.label}</div>
              <div style={{ marginTop: 2, fontSize: "0.875rem", fontWeight: 600 }}>
                {formatPrice(item.value, currency)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ⑤ 사실 진술 문장 */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: "0.5rem",
          margin: "0.75rem 0 0",
          padding: "0.875rem 1rem",
          background: "var(--surface)",
          borderRadius: 10,
        }}
      >
        <div style={{ flex: 1, fontSize: "0.875rem", lineHeight: 1.65 }}>
          {explanation.trend.map((line) => (
            <p key={line} style={{ margin: "0 0 0.25rem" }}>
              {line}
            </p>
          ))}
        </div>
        <InfoButton onClick={() => setSheetOpen(true)} label="흐름 계산 근거 보기" />
      </div>

      <InfoSheet title="흐름은 이렇게 계산합니다" open={sheetOpen} onClose={() => setSheetOpen(false)}>
        <InfoRow label="무엇을 재는가">
          최근 20거래일의 평균 가격과 60거래일의 평균 가격을 각각 구해 둘의 상하 관계를 봅니다.
          단순이동평균(SMA)이며 수정주가 종가를 씁니다.
        </InfoRow>
        <InfoRow label="정배열 · 역배열">
          20일 평균이 60일 평균보다 높으면 정배열, 낮으면 역배열이라고 부릅니다. 두 값 중 하나가
          반드시 크므로 이 값은 항상 존재합니다.
        </InfoRow>
        <InfoRow label="교차">
          두 선의 상하가 뒤바뀐 시점입니다. 스치듯 지나는 교차를 걸러내기 위해 일정 이격 이상
          벌어진 경우만 표시하며, 오래된 교차는 표시하지 않습니다.
          {trend.cross !== null && <> 이 종목의 교차일은 {formatDateKo(trend.cross.date)}입니다.</>}
        </InfoRow>
        <InfoRow label="차트에 눈금이 없는 이유">
          전달하려는 것이 가격의 절대 수준이 아니라 두 선의 상하 관계와 교차 지점이기 때문입니다.
          두 선은 같은 축으로 그려 상하 관계가 사실과 어긋나지 않게 했습니다.
        </InfoRow>
        <InfoRow label="기간 토글은 여기서 무엇을 바꾸는가">
          20일·60일이라는 비교 대상 자체는 바뀌지 않습니다. 바뀌는 건 차트가 보여주는
          창의 길이입니다 — 같은 두 선의 관계를 최근 {period}거래일 동안 훑어보는 것입니다.
        </InfoRow>
        <InfoRow label="한계">
          이동평균은 지나간 가격을 평균한 값이라 항상 뒤늦게 움직입니다. 앞으로의 가격을 말해주지
          않습니다.
        </InfoRow>
      </InfoSheet>
    </div>
  );
}

function Card({ title, body }: { title: string; body: string }) {
  return (
    <div
      style={{
        padding: "0.875rem 1rem",
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 10,
      }}
    >
      <div style={{ fontSize: "0.8125rem", fontWeight: 600 }}>{title}</div>
      <p
        style={{
          margin: "0.25rem 0 0",
          fontSize: "0.75rem",
          color: "var(--text-muted)",
          lineHeight: 1.6,
        }}
      >
        {body}
      </p>
    </div>
  );
}
