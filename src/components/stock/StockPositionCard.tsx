/**
 * 화면 2 의 캐릭터 카드 — 포즈 + 구간 라벨 + 퍼센타일 (PRD §5.3)
 *
 * ── 포즈가 곧 위치다 ──────────────────────────────────────────────
 *
 * 구간마다 서로 다른 포즈 이미지를 쓴다. 캐릭터가 손을 어디에 두고 있는지가
 * 곧 "지금 어디쯤인가"에 대한 답이다.
 *
 * ── PP-01 을 자산 수준에서 강제한다 ──────────────────────────────
 *
 * 여섯 장은 **같은 표정**으로 그려진 고정 자산이다. 코드는 어느 장을 보여줄지만
 * 고르고, 그림 자체에는 손대지 않는다. 필터·색조·변형을 걸지 않는 이유가
 * 이것이다 — 위치에 따라 표정이나 색이 달라지는 순간 캐릭터가 평가자가 된다.
 * 유일하게 허용한 변형은 등장 시 scale 0.97 → 1.0 인데, 이는 포즈가 바뀌었다는
 * 사실만 전달할 뿐 어느 포즈가 더 좋다고 말하지 않는다.
 *
 * ── 전환 규칙 ────────────────────────────────────────────────────
 *
 *   구간이 그대로면  → 이미지는 유지, 숫자만 250ms 카운트
 *   구간이 바뀌면    → 두 포즈를 겹쳐 250ms 크로스페이드 +
 *                      같은 타이밍에 숫자 카운트 + 라벨 크로스페이드
 *
 * 순간 교체("짠" 하고 바뀌는 것)를 하지 않는다. 60일과 250일은 같은 종목의
 * 다른 척도이지 다른 종목이 아니다. 미끄러지듯 바뀌어야 그 인과가 전달된다.
 */

"use client";

import { useEffect, useRef, useState } from "react";
import { preload } from "react-dom";

import { zoneLabel } from "@/lib/indicators/zone";
import {
  EASE_IN_OUT,
  TRANSITION_MS,
  useCountTween,
  usePrefersReducedMotion,
} from "@/lib/ui/motion";
import { BODY_ZONES, type BodyZone, type PeriodDays } from "@/lib/types";

const POSE_SRC: Record<BodyZone, string> = {
  FOOT: "/poses/foot.webp",
  KNEE: "/poses/knee.webp",
  WAIST: "/poses/waist.webp",
  CHEST: "/poses/chest.webp",
  SHOULDER: "/poses/shoulder.webp",
  HEAD: "/poses/head.webp",
};

/** 정규화된 포즈 캔버스 (scripts/build-poses.py) */
const POSE_W = 600;
const POSE_H = 760;

interface Props {
  periodDays: PeriodDays;
  percentile: number;
  zone: BodyZone;
}

export function StockPositionCard({ periodDays, percentile, zone }: Props) {
  const reduced = usePrefersReducedMotion();

  // 여섯 장을 전부 미리 받아둔다. 전환 시점에 네트워크가 걸리면 크로스페이드
  // 도중 빈 칸이 스쳐 지나간다 — 그게 깜빡임으로 보인다.
  for (const z of BODY_ZONES) preload(POSE_SRC[z], { as: "image" });

  const { incoming, outgoing } = useCrossfade(zone, reduced);
  const shownPercentile = useCountTween(percentile, !reduced);

  return (
    <div>
      <div
        style={{
          position: "relative",
          width: "100%",
          maxWidth: 200,
          margin: "0 auto",
          // 겹쳐 놓을 두 이미지가 흔들리지 않도록 박스를 고정한다
          aspectRatio: `${POSE_W} / ${POSE_H}`,
        }}
      >
        {/* 나가는 포즈 — 전환 중에만 DOM 에 있다 */}
        {outgoing !== null && <Pose zone={outgoing} state="leaving" />}
        <Pose zone={incoming} state={outgoing === null ? "settled" : "entering"} />
      </div>

      <div
        style={{
          marginTop: "1.25rem",
          textAlign: "center",
          fontSize: "1.5rem",
          fontWeight: 700,
          letterSpacing: "-0.02em",
        }}
      >
        <ZoneLabel incoming={incoming} outgoing={outgoing} />
        <span style={{ color: "var(--text-muted)", fontWeight: 500 }}>
          {" · "}
          {Math.round(shownPercentile)}%
        </span>
      </div>

      <p
        style={{
          margin: "0.25rem 0 0",
          textAlign: "center",
          fontSize: "0.75rem",
          color: "var(--text-subtle)",
        }}
      >
        최근 {periodDays}거래일 기준
      </p>
    </div>
  );
}

type PoseState = "entering" | "leaving" | "settled";

function Pose({ zone, state }: { zone: BodyZone; state: PoseState }) {
  const entering = state === "entering";
  const leaving = state === "leaving";

  // 마운트 직후 한 프레임 뒤에 목표 상태로 넘긴다. 처음부터 목표값이면
  // 브라우저가 전환할 구간을 못 잡고 그냥 나타난다.
  const [settled, setSettled] = useState(!entering);
  useEffect(() => {
    if (!entering) return;
    const id = requestAnimationFrame(() => setSettled(true));
    return () => cancelAnimationFrame(id);
  }, [entering]);

  const visible = leaving ? false : settled;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={POSE_SRC[zone]}
      alt={`${zoneLabel(zone)} 자세를 취한 캐릭터`}
      width={POSE_W}
      height={POSE_H}
      draggable={false}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        // 원본 캔버스가 서로 달라도 박스 안에서 흔들리지 않게 한다
        objectFit: "contain",
        opacity: visible ? 1 : 0,
        transform: visible ? "scale(1)" : "scale(0.97)",
        transition: `opacity ${TRANSITION_MS}ms ${EASE_IN_OUT}, transform ${TRANSITION_MS}ms ${EASE_IN_OUT}`,
        userSelect: "none",
      }}
    />
  );
}

function ZoneLabel({ incoming, outgoing }: { incoming: BodyZone; outgoing: BodyZone | null }) {
  return (
    <span style={{ position: "relative", display: "inline-block" }}>
      {outgoing !== null && (
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            opacity: 0,
            transition: `opacity ${TRANSITION_MS}ms ${EASE_IN_OUT}`,
          }}
        >
          {zoneLabel(outgoing)}
        </span>
      )}
      <FadeIn key={incoming}>{zoneLabel(incoming)}</FadeIn>
    </span>
  );
}

function FadeIn({ children }: { children: React.ReactNode }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <span
      style={{
        display: "inline-block",
        opacity: shown ? 1 : 0,
        transition: `opacity ${TRANSITION_MS}ms ${EASE_IN_OUT}`,
      }}
    >
      {children}
    </span>
  );
}

/**
 * 구간이 바뀌면 이전 포즈를 전환이 끝날 때까지만 살려둔다.
 *
 * 테스트용으로 내보낸다 — 이 상태 기계가 "언제 두 장이 겹쳐 있는가"를
 * 결정하므로, 렌더링과 분리해 검사할 수 있어야 한다.
 *
 * 구간이 그대로면 `outgoing` 은 계속 null 이고 이미지는 교체되지 않는다 —
 * 120일 무릎 32% → 60일 무릎 38% 에서 그림이 깜빡일 이유가 없다.
 */
export function useCrossfade(zone: BodyZone, reduced: boolean) {
  const [incoming, setIncoming] = useState(zone);
  const [outgoing, setOutgoing] = useState<BodyZone | null>(null);
  const previous = useRef(zone);

  useEffect(() => {
    if (previous.current === zone) return;

    if (reduced) {
      // 애니메이션 없이 즉시 교체. 최종 상태는 동일하다.
      previous.current = zone;
      setOutgoing(null);
      setIncoming(zone);
      return;
    }

    setOutgoing(previous.current);
    setIncoming(zone);
    previous.current = zone;

    const id = setTimeout(() => setOutgoing(null), TRANSITION_MS);
    return () => clearTimeout(id);
  }, [zone, reduced]);

  return { incoming, outgoing };
}
