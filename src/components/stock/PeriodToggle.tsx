/**
 * 기간 토글 (PRD §4.1 F-POS-04, §5.3 ⑥)
 *
 * 계약 확장 E-01 덕분에 세 기간이 한 응답에 다 들어 있다. 여기서 상태만
 * 바꾸면 순수 렌더로 끝나고 네트워크가 나가지 않는다 — §14.2 의
 * "기간 토글 반영 < 100ms" 가 성립하는 이유다.
 *
 * 라벨은 거래일 수(예: "60일")가 아니라 단기/중기/장기다 — 화면 2(위치)
 * 는 그 기간의 가격 분포를, 화면 3(흐름)은 그 기간에 맞는 MA 쌍을 보여주며
 * 둘 다 같은 세 티어를 공유한다 (`types.ts` 의 `PeriodDays` 주석 참고).
 */

"use client";

import { PERIOD_LABEL, PERIOD_OPTIONS, type PeriodDays } from "@/lib/types";

interface Props {
  value: PeriodDays;
  onChange: (period: PeriodDays) => void;
}

export function PeriodToggle({ value, onChange }: Props) {
  return (
    <div
      role="tablist"
      aria-label="기간 선택"
      style={{
        display: "flex",
        gap: 2,
        padding: 2,
        background: "var(--surface-strong)",
        borderRadius: 8,
      }}
    >
      {PERIOD_OPTIONS.map((period) => {
        const selected = period === value;
        return (
          <button
            key={period}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(period)}
            style={{
              flex: 1,
              padding: "0.4375rem 0",
              border: "none",
              borderRadius: 6,
              background: selected ? "var(--bg)" : "transparent",
              color: selected ? "var(--text)" : "var(--text-muted)",
              fontSize: "0.8125rem",
              fontWeight: selected ? 600 : 500,
              cursor: "pointer",
              // 최소 터치 타깃
              minHeight: 36,
            }}
          >
            {PERIOD_LABEL[period]}
          </button>
        );
      })}
    </div>
  );
}
