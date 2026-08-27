/**
 * 전환 애니메이션 (PRD §5.3)
 *
 * 카운트 보간의 성질을 못박는다. 특히 **접근성 규칙**이 중요하다 —
 * 애니메이션을 걷어내도 최종 상태는 같아야 한다.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { TRANSITION_MS, useCountTween } from "../src/lib/ui/motion";

/** rAF 를 가짜 타이머에 묶어 프레임을 직접 돌린다 */
function installFakeRaf() {
  let now = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
  let nextId = 1;

  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    const id = nextId++;
    callbacks.set(id, cb);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    callbacks.delete(id);
  });
  vi.stubGlobal("performance", { now: () => now });

  return {
    /** ms 만큼 시간을 흘리며 대기 중인 프레임을 실행한다 */
    advance(ms: number) {
      now += ms;
      const pending = [...callbacks.entries()];
      callbacks.clear();
      for (const [, cb] of pending) cb(now);
    },
    get pending() {
      return callbacks.size;
    },
  };
}

describe("useCountTween", () => {
  let raf: ReturnType<typeof installFakeRaf>;

  beforeEach(() => {
    raf = installFakeRaf();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("첫 값은 보간 없이 그대로 보여준다", () => {
    const { result } = renderHook(() => useCountTween(32, true));
    expect(result.current).toBe(32);
  });

  it("목표가 바뀌면 중간값을 거쳐 도달한다", () => {
    const { result, rerender } = renderHook(({ v }) => useCountTween(v, true), {
      initialProps: { v: 32 },
    });

    rerender({ v: 38 });
    act(() => raf.advance(TRANSITION_MS / 2));

    // 정확한 값은 이징에 달렸지만, 두 끝값 사이에 있어야 한다
    expect(result.current).toBeGreaterThan(32);
    expect(result.current).toBeLessThan(38);

    act(() => raf.advance(TRANSITION_MS / 2));
    expect(result.current).toBeCloseTo(38, 6);
  });

  it("보간이 끝나면 정확히 목표값이다 (근사값으로 멈추지 않는다)", () => {
    const { result, rerender } = renderHook(({ v }) => useCountTween(v, true), {
      initialProps: { v: 0 },
    });

    rerender({ v: 79.3 });
    act(() => raf.advance(TRANSITION_MS + 50));

    expect(result.current).toBe(79.3);
  });

  it("animate=false 면 즉시 목표값이 된다 (prefers-reduced-motion)", () => {
    // 애니메이션을 걷어내도 최종 상태는 동일해야 한다
    const { result, rerender } = renderHook(({ v }) => useCountTween(v, false), {
      initialProps: { v: 32 },
    });

    rerender({ v: 38 });
    expect(result.current).toBe(38);
    expect(raf.pending).toBe(0); // 프레임을 예약조차 하지 않는다
  });

  it("보간 도중 목표가 또 바뀌면 지금 보이는 값에서 이어간다", () => {
    // 토글 연타. 0 으로 되돌아갔다가 다시 올라가면 값이 튄다.
    const { result, rerender } = renderHook(({ v }) => useCountTween(v, true), {
      initialProps: { v: 20 },
    });

    rerender({ v: 80 });
    act(() => raf.advance(TRANSITION_MS / 2));
    const midway = result.current;
    expect(midway).toBeGreaterThan(20);
    expect(midway).toBeLessThan(80);

    // 절반쯤 온 상태에서 다른 목표로
    rerender({ v: 50 });
    act(() => raf.advance(1));

    // 중단 지점 근처에서 출발해야 한다 — 20 으로 되돌아가면 안 된다
    expect(Math.abs(result.current - midway)).toBeLessThan(5);

    act(() => raf.advance(TRANSITION_MS));
    expect(result.current).toBe(50);
  });

  it("목표가 그대로면 프레임을 예약하지 않는다", () => {
    // 구간도 값도 안 바뀌었는데 매번 애니메이션이 돌면 낭비다
    const { rerender } = renderHook(({ v }) => useCountTween(v, true), {
      initialProps: { v: 32 },
    });

    rerender({ v: 32 });
    expect(raf.pending).toBe(0);
  });
});
