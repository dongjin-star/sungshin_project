/**
 * 이동평균 미니 차트 (PRD §5.4-a)
 *
 * 전체 캔들 차트를 그리지 않는다. 선택한 기간(단기/중기/장기)의 두 MA 선만
 * **축·눈금 없이** 얇게 그린다. 전달 대상은 두 선의 상하 관계와 교차
 * 지점뿐이다. 어느 기간을 비교하는지는(5·20 / 20·60 / 60·120) 고정하지
 * 않는다 — `shortPeriod`/`longPeriod` 로 받아 라벨을 그때그때 조립한다.
 *
 *   · Y축 눈금·가격 라벨 없음
 *   · 캔들·거래량 없음
 *   · 교차 지점에 점 마커
 *
 * ⚠️ 눈금이 없다는 것은 "대충 그렸다"는 뜻이 아니다. 두 선을 **같은 스케일**에
 *    놓아야 상하 관계가 사실과 일치한다. 각자 정규화하면 그림이 거짓말을 한다.
 */

"use client";

import type { CrossInfo } from "@/lib/types";

const WIDTH = 320;
const HEIGHT = 96;
const PAD = 6;

interface Props {
  series: readonly { date: string; short: number; long: number }[];
  cross: CrossInfo | null;
  shortPeriod: number;
  longPeriod: number;
}

export function MaChart({ series, cross, shortPeriod, longPeriod }: Props) {
  if (series.length < 2) return null;

  // 두 선을 하나의 범위로 스케일한다 (위 주석 참조)
  let min = Infinity;
  let max = -Infinity;
  for (const p of series) {
    min = Math.min(min, p.short, p.long);
    max = Math.max(max, p.short, p.long);
  }
  const span = max - min || 1;

  const x = (i: number): number => PAD + (i / (series.length - 1)) * (WIDTH - PAD * 2);
  const y = (v: number): number => HEIGHT - PAD - ((v - min) / span) * (HEIGHT - PAD * 2);

  const path = (key: "short" | "long"): string =>
    series.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(p[key]).toFixed(1)}`).join(" ");

  // 교차 지점을 시리즈 안에서 찾는다. 시리즈 범위 밖이면 마커를 생략한다.
  const crossIndex = cross === null ? -1 : series.findIndex((p) => p.date === cross.date);
  const crossPoint =
    crossIndex >= 0 ? { cx: x(crossIndex), cy: y(series[crossIndex]!.short) } : null;

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      width="100%"
      height="auto"
      role="img"
      aria-label={`최근 ${series.length}거래일 ${shortPeriod}일 평균선과 ${longPeriod}일 평균선의 상대 위치`}
      style={{ display: "block" }}
    >
      {/* 장기 쪽 — 얇은 선 */}
      <path d={path("long")} fill="none" stroke="var(--ma-long)" strokeWidth="1.25" />
      {/* 단기 쪽 — 굵은 선 */}
      <path
        d={path("short")}
        fill="none"
        stroke="var(--ma-short)"
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {crossPoint !== null && (
        <>
          <circle cx={crossPoint.cx} cy={crossPoint.cy} r="5" fill="var(--bg)" />
          <circle
            cx={crossPoint.cx}
            cy={crossPoint.cy}
            r="3.5"
            fill="none"
            stroke="var(--text)"
            strokeWidth="1.5"
          />
        </>
      )}
    </svg>
  );
}

/** 범례. 선 굵기만으로는 어느 쪽이 몇 일 평균인지 알 수 없다 */
export function MaLegend({ shortPeriod, longPeriod }: { shortPeriod: number; longPeriod: number }) {
  return (
    <div style={{ display: "flex", gap: "1rem", fontSize: "0.6875rem", color: "var(--text-subtle)" }}>
      <span style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
        <span style={{ width: 14, height: 2.5, borderRadius: 2, background: "var(--ma-short)" }} />
        {shortPeriod}일 평균
      </span>
      <span style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
        <span style={{ width: 14, height: 1.5, borderRadius: 2, background: "var(--ma-long)" }} />
        {longPeriod}일 평균
      </span>
    </div>
  );
}
