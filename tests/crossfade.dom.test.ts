/**
 * 포즈 크로스페이드 상태 기계 (PRD §5.3)
 *
 * 이 훅이 결정하는 것은 하나다 — **언제 두 포즈가 동시에 DOM 에 있는가.**
 * 겹치는 구간이 없으면 "짠" 하고 순간 교체되고, 안 걷히면 메모리에 남는다.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { useCrossfade } from "../src/components/stock/StockPositionCard";
import { TRANSITION_MS } from "../src/lib/ui/motion";
import type { BodyZone } from "../src/lib/types";

afterEach(() => {
  vi.useRealTimers();
});

describe("useCrossfade — 구간이 그대로일 때", () => {
  it("이미지를 교체하지 않는다", () => {
    // 120일 무릎 32% → 60일 무릎 38%. 그림이 깜빡일 이유가 없다.
    const { result, rerender } = renderHook(({ z }) => useCrossfade(z, false), {
      initialProps: { z: "KNEE" as BodyZone },
    });

    rerender({ z: "KNEE" as BodyZone });

    expect(result.current.incoming).toBe("KNEE");
    expect(result.current.outgoing).toBeNull();
  });
});

describe("useCrossfade — 구간이 바뀔 때", () => {
  it("전환 중에는 두 포즈가 함께 있다", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ z }) => useCrossfade(z, false), {
      initialProps: { z: "KNEE" as BodyZone },
    });

    rerender({ z: "WAIST" as BodyZone });

    expect(result.current.incoming).toBe("WAIST");
    expect(result.current.outgoing).toBe("KNEE");
  });

  it("전환이 끝나면 이전 포즈를 걷어낸다", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ z }) => useCrossfade(z, false), {
      initialProps: { z: "KNEE" as BodyZone },
    });

    rerender({ z: "WAIST" as BodyZone });
    expect(result.current.outgoing).toBe("KNEE");

    act(() => {
      vi.advanceTimersByTime(TRANSITION_MS + 1);
    });

    expect(result.current.outgoing).toBeNull();
    expect(result.current.incoming).toBe("WAIST");
  });

  it("연속 전환에서도 직전 포즈를 가리킨다", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ z }) => useCrossfade(z, false), {
      initialProps: { z: "FOOT" as BodyZone },
    });

    rerender({ z: "KNEE" as BodyZone });
    expect(result.current.outgoing).toBe("FOOT");

    // 전환이 끝나기 전에 또 바뀐다
    act(() => {
      vi.advanceTimersByTime(TRANSITION_MS / 2);
    });
    rerender({ z: "HEAD" as BodyZone });

    expect(result.current.incoming).toBe("HEAD");
    expect(result.current.outgoing).toBe("KNEE");
  });
});

describe("useCrossfade — prefers-reduced-motion", () => {
  it("겹치는 구간 없이 즉시 교체한다", () => {
    const { result, rerender } = renderHook(({ z }) => useCrossfade(z, true), {
      initialProps: { z: "KNEE" as BodyZone },
    });

    rerender({ z: "HEAD" as BodyZone });

    // 최종 상태는 애니메이션이 있을 때와 같다
    expect(result.current.incoming).toBe("HEAD");
    expect(result.current.outgoing).toBeNull();
  });
});
