/**
 * 상시 Disclaimer (PRD F-LEGAL-01, §13.3)
 *
 * "모든 분석 화면 하단 고정. 스크롤과 무관하게 상시 노출."
 * 문구는 templates.ts 가 소유한다 — 화면마다 다르게 쓰면 §13 의
 * 법적 포지션이 화면별로 달라진다.
 */

import { DISCLAIMER_BAR } from "@/lib/templates";

export function DisclaimerBar() {
  return (
    <p
      // 스크린리더가 본문 흐름 속 각주가 아니라 고지로 읽도록
      role="note"
      style={{
        position: "fixed",
        bottom: 0,
        left: "50%",
        transform: "translateX(-50%)",
        width: "100%",
        maxWidth: "var(--app-width)",
        margin: 0,
        padding: "0.625rem 1rem calc(0.625rem + env(safe-area-inset-bottom))",
        background: "var(--surface-strong)",
        borderTop: "1px solid var(--border)",
        color: "var(--text-muted)",
        fontSize: "0.6875rem",
        lineHeight: 1.45,
        textAlign: "center",
        zIndex: 20,
      }}
    >
      {DISCLAIMER_BAR}
    </p>
  );
}
