/**
 * 퍼센타일 → 캐릭터 세로 위치 (PRD §7.3, §5.3)
 *
 * 이 값은 마커를 **어디에 그릴지**만 정한다. 그래도 틀리면 앱의 유일한
 * 시각 은유가 거짓말을 하므로, 성질 세 가지를 못박아 둔다.
 *   · 단조 증가 — 퍼센타일이 높은데 마커가 내려가는 일은 없어야 한다
 *   · 구간 중앙에서 §7.3 의 앵커 값과 정확히 일치
 *   · 0~1 을 벗어나지 않는다
 */

import { describe, expect, it } from "vitest";

import { ZONE_BODY_HEIGHT, ZONE_RANGES, bodyHeightOf } from "../src/lib/indicators/zone";

describe("bodyHeightOf — 앵커", () => {
  it.each(ZONE_RANGES.map((r) => [r.zone, (r.min + r.max) / 2, ZONE_BODY_HEIGHT[r.zone]] as const))(
    "%s 구간 중앙(%s%%)은 앵커 높이 %s 와 일치한다",
    (_zone, centerPercentile, expected) => {
      expect(bodyHeightOf(centerPercentile)).toBeCloseTo(expected, 10);
    },
  );
});

describe("bodyHeightOf — 단조성", () => {
  it("퍼센타일이 오르면 높이도 오른다 (0~100 전 구간)", () => {
    let previous = -Infinity;
    for (let p = 0; p <= 100; p += 0.5) {
      const h = bodyHeightOf(p);
      expect(h).toBeGreaterThanOrEqual(previous);
      previous = h;
    }
  });

  it("같은 구간 안에서도 값이 달라진다", () => {
    // 6개 위치로만 튀면 §5.3 이 지목한 기간 토글 애니메이션이 의미를 잃는다.
    // 42% 와 54% 는 같은 '허리'지만 같은 자리는 아니다.
    expect(bodyHeightOf(42)).not.toBeCloseTo(bodyHeightOf(54), 5);
  });
});

describe("bodyHeightOf — 경계", () => {
  it("0%와 100%도 0~1 안에 머문다", () => {
    for (const p of [0, 0.1, 99.9, 100]) {
      const h = bodyHeightOf(p);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(1);
    }
  });

  it("첫 앵커 아래는 발끝 높이로 고정된다", () => {
    // FOOT 중앙(5%) 아래로는 더 내려갈 앵커가 없다
    expect(bodyHeightOf(0)).toBeCloseTo(ZONE_BODY_HEIGHT.FOOT, 10);
    expect(bodyHeightOf(3)).toBeCloseTo(ZONE_BODY_HEIGHT.FOOT, 10);
  });

  it("마지막 앵커 위는 정수리 높이로 고정된다", () => {
    expect(bodyHeightOf(100)).toBeCloseTo(ZONE_BODY_HEIGHT.HEAD, 10);
    expect(bodyHeightOf(95)).toBeCloseTo(ZONE_BODY_HEIGHT.HEAD, 10);
  });

  it("범위를 벗어난 입력도 잘라낸다", () => {
    expect(bodyHeightOf(-20)).toBeCloseTo(ZONE_BODY_HEIGHT.FOOT, 10);
    expect(bodyHeightOf(140)).toBeCloseTo(ZONE_BODY_HEIGHT.HEAD, 10);
  });
});

describe("bodyHeightOf — 실제 사례", () => {
  it("삼성전자: 같은 종목이 기간에 따라 다른 높이에 선다", () => {
    // 2026-08-28 실측값. §5.3 이 "값이 튀는 게 아니라 같은 종목의 다른 척도"
    // 라고 한 상황이 실제로 이 종목에서 일어난다.
    const h60 = bodyHeightOf(42.5); // 허리
    const h250 = bodyHeightOf(79.3); // 어깨

    expect(h60).toBeLessThan(h250);
    expect(h250 - h60).toBeGreaterThan(0.2); // 눈에 띄게 이동한다
  });
});
