/**
 * 캐릭터 슬롯 (PRD §5.3 ③, D-01)
 *
 * ── 이 파일이 존재하는 이유 ────────────────────────────────────────
 *
 * D-01(캐릭터 비주얼)은 기획자가 이미지로 제공하기로 했고 아직 도착하지
 * 않았다. 그렇다고 1-5 를 멈출 이유는 없다 — 캐릭터가 **어떻게 생겼는지**는
 * 위치 계산·마커 정렬·애니메이션 중 무엇에도 영향을 주지 않기 때문이다.
 *
 * 그래서 아트를 이 파일 하나로 격리한다. 에셋이 오면 `CharacterArt` 의
 * 내용만 갈아끼우면 되고, 나머지 화면은 손대지 않는다.
 *
 * ── PP-01 을 구조로 강제한다 ──────────────────────────────────────
 *
 * "캐릭터는 눈금자이지 평가자가 아니다." 그래서 `CharacterArt` 는
 * **퍼센타일도, 구간도, 등락률도 인자로 받지 않는다.** 받을 수 없으니
 * 위치에 따라 표정이나 색을 바꾸는 코드를 애초에 쓸 수 없다.
 *
 * 마커는 아트 위에 얹힌 별도 레이어다. 아트가 바뀌어도 마커는 그대로다.
 */

"use client";

import { bodyHeightOf, zoneLabel } from "@/lib/indicators/zone";
import type { BodyZone } from "@/lib/types";

/** 캐릭터 박스의 세로:가로 비율. 아트 교체 시 여기도 같이 맞춘다 */
const ASPECT = 0.42;

interface Props {
  /** 0~100. null 이면 마커를 그리지 않는다 (계산 불가 상태) */
  percentile: number | null;
  /** 히스테리시스가 적용된 표시용 구간 */
  zone: BodyZone | null;
}

export function Character({ percentile, zone }: Props) {
  // 0 = 발끝, 1 = 정수리 → CSS 는 위에서부터 재므로 뒤집는다
  const height = percentile === null ? null : bodyHeightOf(percentile);
  const topPct = height === null ? null : (1 - height) * 100;

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        aspectRatio: `${ASPECT}`,
        margin: "0 auto",
        maxWidth: 200,
      }}
    >
      <CharacterArt />

      {topPct !== null && zone !== null && (
        <Marker topPct={topPct} zone={zone} />
      )}
    </div>
  );
}

/**
 * 마커 — 신체 우측에 수평선 + 라벨 (§5.3 UX)
 *
 * 400ms 이동 애니메이션이 §5.3 이 지목한 "가장 중요한 마이크로 인터랙션"이다.
 * 값이 교체되는 게 아니라 **기준을 바꾸니 위치가 달라졌다**는 인과를 전달한다.
 * `prefers-reduced-motion` 은 globals.css 가 전역으로 걷어낸다.
 */
function Marker({ topPct, zone }: { topPct: number; zone: BodyZone }) {
  return (
    <div
      style={{
        position: "absolute",
        top: `${topPct}%`,
        left: "50%",
        right: "-100%",
        display: "flex",
        alignItems: "center",
        gap: "0.375rem",
        transform: "translateY(-50%)",
        transition: "top 400ms cubic-bezier(0.4, 0, 0.2, 1)",
        pointerEvents: "none",
      }}
    >
      <span
        style={{
          flex: 1,
          height: 1,
          background: "var(--marker-line)",
        }}
      />
      <span
        style={{
          flexShrink: 0,
          fontSize: "0.75rem",
          fontWeight: 600,
          color: "var(--text-muted)",
          whiteSpace: "nowrap",
        }}
      >
        {zoneLabel(zone)}
      </span>
    </div>
  );
}

/**
 * ⛳ 교체 지점 — 여기만 갈아끼우면 된다.
 *
 * 현재는 기하학적 실루엣 플레이스홀더다. 아트가 도착하면 이 함수의 반환값을
 * 새 SVG(또는 `<img>`)로 바꾸고 위의 `ASPECT` 를 새 비율에 맞춘다.
 *
 * 지켜야 할 계약은 두 가지뿐이다.
 *   1. 박스를 세로로 가득 채운다 — 발끝이 바닥(0), 정수리가 천장(1).
 *      `ZONE_BODY_HEIGHT`(§7.3) 가 이 좌표계를 전제한다.
 *   2. 인자를 받지 않는다 (PP-01).
 */
function CharacterArt() {
  return (
    <svg
      viewBox="0 0 100 238"
      width="100%"
      height="100%"
      role="presentation"
      aria-hidden="true"
      style={{ display: "block", fill: "var(--character)" }}
    >
      {/* 머리 (정수리 y=0) */}
      <circle cx="50" cy="20" r="19" />
      {/* 목 */}
      <rect x="44" y="38" width="12" height="8" />
      {/* 몸통 — 어깨에서 허리로 좁아진다 */}
      <path d="M28 46 h44 l-5 62 h-34 z" />
      {/* 팔 */}
      <rect x="17" y="48" width="10" height="58" rx="5" />
      <rect x="73" y="48" width="10" height="58" rx="5" />
      {/* 다리 */}
      <rect x="34" y="110" width="13" height="126" rx="6" />
      <rect x="53" y="110" width="13" height="126" rx="6" />
    </svg>
  );
}
