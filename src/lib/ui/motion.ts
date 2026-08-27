"use client";

/**
 * 전환 애니메이션 유틸 (PRD §5.3, F-A11Y)
 *
 * 라이브러리를 쓰지 않는다. 필요한 것은 숫자 하나를 250ms 동안 보간하는
 * 것뿐인데, framer-motion 은 First Load JS 를 110KB → 145KB 로 키운다.
 * 모바일 우선 앱에서 그만한 값을 치를 이유가 없다. 아래 두 훅이 그 일을
 * 전부 한다.
 */

import { useEffect, useRef, useState } from "react";

/** 포즈 교체·숫자 보간 공통 길이 */
export const TRANSITION_MS = 250;

/** easeInOut (quad). CSS 쪽 cubic-bezier(0.42, 0, 0.58, 1) 과 맞춘다 */
export const EASE_IN_OUT = "cubic-bezier(0.42, 0, 0.58, 1)";

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

/**
 * 사용자가 모션을 줄이겠다고 했는가.
 *
 * 서버에는 matchMedia 가 없다. 첫 렌더는 false 로 맞춰 hydration 불일치를
 * 피하고, 마운트 직후 실제 값으로 바꾼다.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);

    const onChange = (e: MediaQueryListEvent): void => setReduced(e.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return reduced;
}

/**
 * 숫자 카운트 보간.
 *
 * `animate` 가 false 면 보간 없이 즉시 목표값이 된다 — 애니메이션을 걷어내도
 * **최종 상태는 같아야 한다**는 접근성 규칙을 여기서 지킨다.
 *
 * 보간 도중에 목표가 또 바뀌면(토글 연타) 지금 보이는 값에서 이어간다.
 * 0 으로 되돌아갔다가 다시 올라가면 값이 튀는 것처럼 보인다.
 */
export function useCountTween(target: number, animate: boolean): number {
  const [value, setValue] = useState(target);

  // 화면에 실제로 보이는 값. 중단 시 여기서 이어받는다.
  const shown = useRef(target);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    shown.current = value;
  }, [value]);

  useEffect(() => {
    if (!animate) {
      shown.current = target;
      setValue(target);
      return;
    }

    const from = shown.current;
    if (from === target) return;

    const startedAt = performance.now();

    const tick = (now: number): void => {
      const t = Math.min(1, (now - startedAt) / TRANSITION_MS);
      const next = from + (target - from) * easeInOut(t);

      shown.current = next;
      setValue(next);

      if (t < 1) {
        frame.current = requestAnimationFrame(tick);
      } else {
        frame.current = null;
      }
    };

    frame.current = requestAnimationFrame(tick);

    return () => {
      if (frame.current !== null) {
        cancelAnimationFrame(frame.current);
        frame.current = null;
      }
    };
    // value 를 넣으면 매 프레임 효과가 재실행된다. shown 이 그 역할을 대신한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, animate]);

  return value;
}
