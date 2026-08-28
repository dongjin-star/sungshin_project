"use client";

/**
 * 다크/라이트 모드 토글 (D-03, 2026-08-28)
 *
 * 라이트 → 다크 → 시스템 설정 따름 순으로 돈다. "시스템"이 기본값이다 —
 * 아무것도 안 고른 사용자에게는 기기 설정을 그대로 따르는 게 가장
 * 자연스럽다.
 *
 * 실제 색 전환은 이 컴포넌트가 아니라 globals.css 의 `[data-theme]`
 * 선택자가 담당한다. 여기서는 `useTheme()` 을 통해 그 속성을 쓰고
 * localStorage에 저장할 뿐이다. 새로고침 시 깜빡임(FOUC) 방지는
 * layout.tsx 의 beforeInteractive 스크립트가 별도로 처리한다.
 */

import { useTheme } from "@/lib/theme";

const ICON = { light: "☀️", dark: "🌙", system: "🌓" } as const;
const LABEL = { light: "라이트 모드", dark: "다크 모드", system: "시스템 설정 따름" } as const;

export function ThemeToggle() {
  const { mode, cycle } = useTheme();

  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={`화면 모드: ${LABEL[mode]}. 눌러서 전환`}
      title={LABEL[mode]}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 36,
        height: 36,
        flexShrink: 0,
        border: "none",
        borderRadius: 8,
        background: "transparent",
        color: "var(--text-muted)",
        fontSize: "1rem",
        cursor: "pointer",
      }}
    >
      <span aria-hidden="true">{ICON[mode]}</span>
    </button>
  );
}
