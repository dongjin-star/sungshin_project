"use client";

/**
 * 다크/라이트 모드 (D-03, 2026-08-28 — D-02 "라이트 고정" 결정을 뒤집는다)
 *
 * `usePreferences` 의 localStorage 키를 같이 쓰지 않고 별도 키를 둔다.
 * 이유 둘:
 *
 *   1. 새로고침 시 색이 튀는 것(FOUC)을 막으려면 React가 뜨기도 전에
 *      `<head>` 인라인 스크립트가 값을 동기적으로 읽어야 한다 — 이건
 *      `usePreferences` 의 비동기 read()/useEffect 흐름과 안 맞는다.
 *   2. 이 화면 저 화면에서 각자 `useTheme()` 을 부르게 되는데(헤더마다
 *      토글이 있다), `usePreferences` 처럼 "이전 상태 + patch" 로 저장하면
 *      한쪽 인스턴스가 들고 있던 낡은 상태가 다른 인스턴스가 방금 쓴
 *      값을 덮어써 버릴 수 있다. 그래서 쓸 때마다 localStorage를 직접
 *      다시 읽어(stale closure를 안 믿고) 병합한다.
 */

import { useCallback, useEffect, useState } from "react";

import { THEME_STORAGE_KEY } from "./theme-key";

export type ThemeMode = "light" | "dark" | "system";

const MODES: readonly ThemeMode[] = ["light", "dark", "system"];

const NEXT: Record<ThemeMode, ThemeMode> = {
  light: "dark",
  dark: "system",
  system: "light",
};

function isThemeMode(v: unknown): v is ThemeMode {
  return typeof v === "string" && (MODES as readonly string[]).includes(v);
}

export function readTheme(): ThemeMode {
  if (typeof window === "undefined") return "system";
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeMode(raw) ? raw : "system";
  } catch {
    return "system";
  }
}

function writeTheme(mode: ThemeMode): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // 저장 실패가 화면 동작을 막을 이유는 없다 — 이번 세션만 적용된다
  }
}

/** `system` 이면 속성을 아예 지운다 — globals.css 의 `prefers-color-scheme` 이 맡는다 */
export function applyTheme(mode: ThemeMode): void {
  if (typeof document === "undefined") return;
  if (mode === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", mode);
}

export function useTheme() {
  const [mode, setMode] = useState<ThemeMode>("system");

  useEffect(() => {
    const current = readTheme();
    setMode(current);
    applyTheme(current);
  }, []);

  const cycle = useCallback(() => {
    setMode((prev) => {
      const next = NEXT[prev];
      writeTheme(next);
      applyTheme(next);
      return next;
    });
  }, []);

  return { mode, cycle };
}
