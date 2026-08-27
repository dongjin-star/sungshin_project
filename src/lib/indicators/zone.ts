/**
 * 6구간 신체 매핑 + 경계 히스테리시스 (PRD §7.3)
 *
 * ⚠️ PP-01: 이 모듈은 구간 '이름'만 정한다. 색·표정·자세를 반환하지 않는다.
 *    무릎에서 웃고 머리에서 찡그리면 그 자체가 매매 권유다.
 */

import type { BodyZone } from "../types";

interface ZoneRange {
  zone: BodyZone;
  /** 하한 (이상) */
  min: number;
  /** 상한 (미만). HEAD 만 100 이하로 닫힌다 */
  max: number;
  /** 사용자 표시 라벨 */
  label: string;
}

/** PRD §7.3 경계값. 이 테이블이 유일한 진실 소스다 */
export const ZONE_RANGES: readonly ZoneRange[] = [
  { zone: "FOOT", min: 0, max: 10, label: "발" },
  { zone: "KNEE", min: 10, max: 30, label: "무릎" },
  { zone: "WAIST", min: 30, max: 55, label: "허리" },
  { zone: "CHEST", min: 55, max: 72, label: "가슴" },
  { zone: "SHOULDER", min: 72, max: 85, label: "어깨" },
  { zone: "HEAD", min: 85, max: 100, label: "머리" },
] as const;

/** 히스테리시스 폭 (%p). 경계에서 이만큼 벗어나야 구간이 바뀐다 (F-POS-05) */
export const HYSTERESIS_MARGIN = 2.0;

/**
 * 캐릭터 SVG 상의 세로 위치 (0 = 발끝, 1 = 정수리).
 * PRD §7.3 의 "인체 해부학 기준 높이" 열을 그대로 옮긴 값이다.
 * 마커를 그릴 때만 쓰며, 퍼센타일 수치 자체와 혼동하지 않는다.
 */
export const ZONE_BODY_HEIGHT: Record<BodyZone, number> = {
  FOOT: 0.03,
  KNEE: 0.28,
  WAIST: 0.58,
  CHEST: 0.7,
  SHOULDER: 0.82,
  HEAD: 0.95,
};

/**
 * 퍼센타일 → 캐릭터 세로 위치 (0 = 발끝, 1 = 정수리).
 *
 * `ZONE_BODY_HEIGHT` 를 **각 구간 퍼센타일 범위의 중앙에 놓인 앵커**로 보고
 * 앵커 사이를 선형 보간한다. 구간 높이를 그대로 쓰면 마커가 6개 위치로만
 * 튀는데, 그러면 §5.3 이 "이 앱에서 가장 중요한 마이크로 인터랙션"이라고
 * 한 기간 토글 애니메이션이 의미를 잃는다. 42% 와 54% 는 같은 '허리'지만
 * 같은 자리는 아니다.
 *
 * ⚠️ 이 값은 **그림을 그리기 위한 좌표일 뿐** 사용자에게 보여줄 수치가
 *    아니다. 화면에 쓰는 퍼센타일은 언제나 실제 값이다 (PP-03).
 */
export function bodyHeightOf(percentile: number): number {
  const p = clampPercentile(percentile);

  // 앵커: [구간 중앙 퍼센타일, 신체 높이] — ZONE_RANGES 순서 = 아래에서 위
  const anchors = ZONE_RANGES.map(
    (r): [number, number] => [(r.min + r.max) / 2, ZONE_BODY_HEIGHT[r.zone]],
  );

  const first = anchors[0]!;
  const last = anchors[anchors.length - 1]!;
  if (p <= first[0]) return first[1];
  if (p >= last[0]) return last[1];

  for (let i = 0; i < anchors.length - 1; i += 1) {
    const [lowP, lowH] = anchors[i]!;
    const [highP, highH] = anchors[i + 1]!;
    if (p >= lowP && p <= highP) {
      const t = (p - lowP) / (highP - lowP);
      return lowH + t * (highH - lowH);
    }
  }

  return last[1];
}

export function zoneLabel(zone: BodyZone): string {
  return ZONE_RANGES.find((r) => r.zone === zone)!.label;
}

/**
 * 퍼센타일 → 구간. 히스테리시스 없는 raw 매핑.
 * 서버는 항상 이 값을 반환하고, 라벨 보정은 클라이언트가 한다 (계약 확장 E-02).
 */
export function zoneOf(percentile: number): BodyZone {
  const p = clampPercentile(percentile);
  for (const r of ZONE_RANGES) {
    if (p >= r.min && p < r.max) return r.zone;
  }
  // p === 100 (HEAD 는 100 이하로 닫힌 구간)
  return "HEAD";
}

/**
 * 히스테리시스를 적용한 구간 결정 (PRD §7.3).
 *
 *   if (p가 Z의 범위 안)                     → Z 유지
 *   else if (p가 Z의 경계에서 2.0%p 이내)     → Z 유지
 *   else                                     → p 에 해당하는 새 구간
 *
 * 29.5% ↔ 30.5% 를 오갈 때마다 "무릎 ↔ 허리"가 번갈아 뜨면 앱 신뢰도가 무너진다.
 *
 * ⚠️ 히스테리시스는 **구간 라벨에만** 적용된다.
 *    화면에 표시되는 퍼센타일 수치는 언제나 실제 값이어야 한다 (PP-03).
 *
 * @param percentile 현재 퍼센타일
 * @param previousZone 직전에 표시했던 구간. 없으면(최초 표시) raw 매핑을 쓴다
 */
export function zoneWithHysteresis(
  percentile: number,
  previousZone: BodyZone | null,
): BodyZone {
  const p = clampPercentile(percentile);
  const raw = zoneOf(p);

  if (previousZone === null || previousZone === raw) return raw;

  const prev = ZONE_RANGES.find((r) => r.zone === previousZone);
  if (prev === undefined) return raw;

  // 이전 구간의 경계에서 HYSTERESIS_MARGIN 이내로만 벗어났으면 이전 구간을 유지한다.
  // FOOT 의 하단(0)과 HEAD 의 상단(100)은 넘어갈 수 없는 벽이므로 확장하지 않는다.
  const stickyMin = prev.min === 0 ? 0 : prev.min - HYSTERESIS_MARGIN;
  const stickyMax = prev.max === 100 ? 100 : prev.max + HYSTERESIS_MARGIN;

  return p >= stickyMin && p <= stickyMax ? previousZone : raw;
}

function clampPercentile(p: number): number {
  if (Number.isNaN(p)) throw new Error("zone: percentile 이 NaN 이다");
  return Math.min(100, Math.max(0, p));
}
