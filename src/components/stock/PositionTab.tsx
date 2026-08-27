/**
 * 화면 2 — 위치 (PRD §5.3)
 *
 * 목적: 현재가가 선택 기간의 가격 분포에서 어디에 있는지를 **단일 시각**으로.
 *
 * 상태값: LOADING / READY / INSUFFICIENT_DATA / HALTED / ERROR
 * (LOADING·ERROR 는 StockScreen 이 처리하고 여기는 나머지를 맡는다)
 */

"use client";

import { useEffect, useRef, useState } from "react";

import { Character } from "./Character";
import { InfoButton, InfoRow, InfoSheet } from "./InfoSheet";
import { PeriodToggle } from "./PeriodToggle";
import {
  formatDateKo,
  formatPercentileDecimal,
  formatPrice,
} from "@/lib/format";
import { zoneLabel, zoneWithHysteresis } from "@/lib/indicators/zone";
import type { BodyZone, Currency, PeriodDays, PositionBlock } from "@/lib/types";
import type { ExplanationSet } from "@/lib/templates";

interface Props {
  position: PositionBlock;
  explanation: ExplanationSet;
  currency: Currency;
  period: PeriodDays;
  onPeriodChange: (period: PeriodDays) => void;
  /** 거래정지 등 계산을 막는 사유 (§12.1) */
  haltedLabel: string | null;
}

export function PositionTab({
  position,
  explanation,
  currency,
  period,
  onPeriodChange,
  haltedLabel,
}: Props) {
  const [sheetOpen, setSheetOpen] = useState(false);

  // 히스테리시스는 **직전에 보여준 구간**을 알아야 걸린다 (F-POS-05, E-02).
  // 서버는 raw 구간만 주므로 표시 이력은 클라이언트가 들고 있는다.
  const previousZone = useRef<BodyZone | null>(null);
  const rawZone = position.zone;
  const shownZone =
    rawZone === null ? null : zoneWithHysteresis(position.percentile ?? 0, previousZone.current);

  useEffect(() => {
    if (shownZone !== null) previousZone.current = shownZone;
  }, [shownZone]);

  // 기간을 바꾸면 다른 척도가 된다. 그때는 이전 구간에 붙잡아 둘 이유가 없다.
  useEffect(() => {
    previousZone.current = null;
  }, [period]);

  return (
    <div style={{ padding: "0 1rem" }}>
      <PeriodToggle value={period} onChange={onPeriodChange} />

      {haltedLabel !== null ? (
        <Notice
          title={`${haltedLabel} 종목입니다`}
          body="거래가 정상적으로 이루어지지 않는 기간의 가격은 분포를 왜곡하므로 위치를 계산하지 않습니다."
        />
      ) : !position.available ? (
        <Notice
          title="위치를 계산할 수 없습니다"
          body={`이 종목은 상장 기간이 짧아 ${position.requestedPeriodDays}거래일치 가격 자료가 없습니다. 확보된 거래일은 ${position.dataPoints}일입니다.`}
        />
      ) : (
        <>
          {position.downgraded && (
            <Notice
              title={`${position.periodDays}일 기준으로 계산했습니다`}
              body={`${position.requestedPeriodDays}거래일치 자료가 없어 확보된 ${position.dataPoints}거래일로 기간을 줄였습니다.`}
              tone="muted"
            />
          )}

          {position.flatPrices && (
            <Notice
              title="이 기간의 가격이 모두 같습니다"
              body="분포가 없으므로 위치 해석에 의미가 없습니다."
              tone="muted"
            />
          )}

          <div style={{ margin: "1.5rem 0 0.5rem" }}>
            <Character percentile={position.percentile} zone={shownZone} />
          </div>

          <div style={{ textAlign: "center", marginTop: "1.25rem" }}>
            <div style={{ fontSize: "1.5rem", fontWeight: 700, letterSpacing: "-0.02em" }}>
              {shownZone !== null && zoneLabel(shownZone)}
              {position.percentile !== null && (
                <span style={{ color: "var(--text-muted)", fontWeight: 500 }}>
                  {" · "}
                  {formatPercentileDecimal(position.percentile)}%
                </span>
              )}
            </div>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: "0.5rem",
              margin: "1.25rem 0 0",
              padding: "0.875rem 1rem",
              background: "var(--surface)",
              borderRadius: 10,
            }}
          >
            <div style={{ flex: 1, fontSize: "0.875rem", lineHeight: 1.65 }}>
              {explanation.position.map((line) => (
                <p key={line} style={{ margin: "0 0 0.25rem" }}>
                  {line}
                </p>
              ))}
            </div>
            <InfoButton onClick={() => setSheetOpen(true)} label="위치 계산 근거 보기" />
          </div>

          <PeriodRange position={position} currency={currency} />
        </>
      )}

      <InfoSheet title="위치는 이렇게 계산합니다" open={sheetOpen} onClose={() => setSheetOpen(false)}>
        <InfoRow label="무엇을 재는가">
          선택한 기간의 <strong>종가 분포</strong> 안에서 현재가가 몇 번째에 있는지를 백분위로
          나타낸 값입니다. 가격이 얼마나 올랐는지가 아니라, 그 기간 동안 이 가격보다 낮았던 날이
          얼마나 되는지를 셉니다.
        </InfoRow>
        <InfoRow label="기준 기간">
          최근 {position.periodDays}거래일
          {position.periodStartDate !== null && ` (${formatDateKo(position.periodStartDate)}부터)`}
          {" · "}실제 사용된 거래일 {position.dataPoints}일
        </InfoRow>
        <InfoRow label="당일 봉 제외">
          진행 중인 오늘 봉은 분포에서 제외합니다. 장중에는 값이 계속 바뀌므로 확정된 종가와 같이
          둘 수 없습니다.
        </InfoRow>
        <InfoRow label="구간 라벨">
          퍼센타일을 6구간으로 나눈 이름입니다. 경계에서 라벨이 번갈아 바뀌는 것을 막기 위해 이전
          구간을 2%p 만큼 유지합니다. <strong>표시되는 퍼센타일 수치는 언제나 실제 값</strong>입니다.
        </InfoRow>
        <InfoRow label="한계">
          과거 가격의 분포일 뿐이며 앞으로의 가격과는 무관합니다. 기간을 바꾸면 같은 종목의 위치도
          달라집니다.
        </InfoRow>
      </InfoSheet>
    </div>
  );
}

/** 기간 최고가·최저가 (§5.3 ⑦) */
function PeriodRange({ position, currency }: { position: PositionBlock; currency: Currency }) {
  if (position.periodHigh === null || position.periodLow === null) return null;

  return (
    <div
      style={{
        display: "flex",
        gap: "0.5rem",
        marginTop: "0.75rem",
      }}
    >
      {[
        { label: `${position.periodDays}일 최저`, value: position.periodLow },
        { label: `${position.periodDays}일 최고`, value: position.periodHigh },
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
  );
}

function Notice({
  title,
  body,
  tone = "default",
}: {
  title: string;
  body: string;
  tone?: "default" | "muted";
}) {
  return (
    <div
      style={{
        margin: "1rem 0 0",
        padding: "0.875rem 1rem",
        background: "var(--surface)",
        border: tone === "default" ? "1px solid var(--border)" : "none",
        borderRadius: 10,
      }}
    >
      <div style={{ fontSize: "0.8125rem", fontWeight: 600 }}>{title}</div>
      <div style={{ marginTop: "0.25rem", fontSize: "0.75rem", color: "var(--text-muted)", lineHeight: 1.6 }}>
        {body}
      </div>
    </div>
  );
}
