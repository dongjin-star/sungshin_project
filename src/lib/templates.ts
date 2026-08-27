/**
 * 설명 문구 템플릿 — 결정론적 (PRD §7.6)
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ 🔴 이 파일은 `npm run check:templates` 의 검사 대상이다.              │
 * │    PRD §13.2 금지 표현이 하나라도 들어가면 빌드가 실패한다.           │
 * │    사람의 주의력에 의존하지 않는다 (§7.6 R-05).                       │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * PP-04 — 자연어 생성(LLM)을 쓰지 않는다. 100% 템플릿이다.
 * PP-02 — 모든 문구는 검증 가능한 사실 진술이어야 한다.
 *
 * 조립 규칙 (§7.6-C):
 *   R-01  위치 문장과 추세 문장 사이에 접속사를 쓰지 않는다
 *   R-02  종합 판정 문장을 생성하지 않는다 (PP-05)
 *   R-03  총 4문장 이내
 *   R-04  모든 변수는 서버에서 포맷팅 후 전달
 *   R-05  §13.2 금지어는 등장할 수 없다 (CI 강제)
 *
 * ⚠️ R-01 을 주석이 아니라 **타입으로** 강제한다.
 *    위치 문장과 추세 문장을 서로 다른 배열로 분리해 두면, 두 사실을
 *    "~이며" 같은 접속사로 이어 붙이는 코드를 애초에 쓸 수 없다.
 *    PRD §5.5 의 금지 예시가 정확히 이 실수를 지적한다.
 */

import { formatPercentileInt, formatPrice } from "./format";
import type { Currency, PositionBlock, TrendBlock } from "./types";

/** §7.6-C R-03 — 위치·추세 합쳐 4문장을 넘기지 않는다 */
export const MAX_SENTENCES = 4;

/**
 * 위치 문장과 추세 문장은 절대 한 배열에 섞이지 않는다.
 * 화면 4는 이 둘 사이에 시각적 구분선을 넣어 렌더한다 (§5.5).
 */
export interface ExplanationSet {
  position: string[];
  trend: string[];
}

/** §7.6-A — 위치 문장 */
export function buildPositionSentences(
  position: PositionBlock,
  currency: Currency,
): string[] {
  const out: string[] = [];

  if (!position.available) {
    if (position.reason === "HALTED") {
      out.push("거래가 정지된 종목입니다.");
    } else {
      out.push(
        `가격 데이터가 ${position.dataPoints}일치만 있어 위치를 계산하지 않았습니다.`,
      );
    }
    return out;
  }

  // [필수] 사실 진술. "32% 지점"(해석)이 아니라 "33%의 날보다 높음"(사실)이다.
  if (position.percentile !== null) {
    out.push(
      `최근 ${position.periodDays}거래일 중 약 ${formatPercentileInt(position.percentile)}%의 날보다 높습니다.`,
    );
  }

  // [조건부] 자동 강등 안내. 조용히 기준을 바꾸면 PP-03 위반이다 (§7.7).
  if (position.downgraded) {
    out.push(
      `데이터가 짧아 ${position.periodDays}거래일 기준으로 계산했습니다.`,
    );
  }

  // [조건부] 전 종가가 동일한 경우 (§12.1)
  if (position.flatPrices) {
    out.push("이 기간에는 가격 변동이 없었습니다.");
  }

  // [보조] 기간 최고가·최저가.
  // 퍼센타일(캐릭터 위치)과 이 두 수치는 서로 다른 것을 재는 값이며,
  // 그 사실은 ⓘ 시트에서 별도로 설명한다 (§7.2 보조 표시).
  if (position.periodHigh !== null && position.periodLow !== null) {
    out.push(
      `이 기간의 최고가는 ${formatPrice(position.periodHigh, currency)}, 최저가는 ${formatPrice(position.periodLow, currency)}입니다.`,
    );
  }

  return out;
}

/**
 * §7.6-B — 추세 문장.
 *
 * MA 기간을 하드코딩하지 않는다 — `trend.maShortPeriod`/`maLongPeriod` 로
 * 조립한다. 단기(5·20일)·중기(20·60일)·장기(60·120일) 세 티어가 이 함수
 * 하나를 공유하므로, 숫자를 고정하면 셋 중 둘은 틀린 문장이 나간다.
 */
export function buildTrendSentences(trend: TrendBlock): string[] {
  const out: string[] = [];
  const { maShortPeriod: s, maLongPeriod: l } = trend;

  if (!trend.available) {
    if (trend.reason === "HALTED") return out; // 위치 문장에서 이미 안내했다
    out.push(`${l}일 평균을 계산할 만큼의 데이터가 아직 없습니다.`);
    return out;
  }

  // [필수] 배열 상태는 항상 값이 존재한다 (F-TREND-02)
  if (trend.alignment === "UP") {
    out.push(`${s}일 평균 가격이 ${l}일 평균 가격보다 높습니다.`);
  } else if (trend.alignment === "DOWN") {
    out.push(`${s}일 평균 가격이 ${l}일 평균 가격보다 낮습니다.`);
  }

  // [조건부] 교차
  const cross = trend.cross;
  if (cross !== null) {
    const direction = cross.type === "GOLDEN" ? "위로" : "아래로";
    const when = cross.daysAgo === 0 ? "오늘" : `${cross.daysAgo}거래일 전`;
    out.push(`${when}, ${s}일 평균선이 ${l}일 평균선을 ${direction} 지나갔습니다.`);

    // [조건부] 거래량 미확인. 필터가 아니라 사실 부기다 (§7.5 3단계).
    // 여기 "20일"은 MA 기간이 아니라 cross.ts 의 거래량 평균 창(VOLUME_AVG_DAYS)
    // 이다 — 티어와 무관하게 고정이라 그대로 둔다.
    if (!cross.volumeConfirmed) {
      out.push("그날의 거래량은 최근 20일 평균보다 적었습니다.");
    }
  }

  return out;
}

/**
 * 화면 4용 문장 세트 조립.
 *
 * R-03(4문장 이내)을 넘으면 **보조 문장부터** 잘라낸다.
 * 필수 문장(위치 사실 · 배열 상태)은 언제나 살아남는다.
 */
export function buildExplanations(
  position: PositionBlock,
  trend: TrendBlock,
  currency: Currency,
): ExplanationSet {
  const positionSentences = buildPositionSentences(position, currency);
  const trendSentences = buildTrendSentences(trend);

  let total = positionSentences.length + trendSentences.length;
  // 각 배열의 첫 문장은 필수이므로, 뒤에서부터 보조 문장을 걷어낸다.
  while (total > MAX_SENTENCES) {
    if (positionSentences.length > 1) positionSentences.pop();
    else if (trendSentences.length > 1) trendSentences.pop();
    else break;
    total = positionSentences.length + trendSentences.length;
  }

  return { position: positionSentences, trend: trendSentences };
}

/**
 * ⓘ 계산 근거 시트 문구 (§13.3).
 * 한계 고지 2건은 PRD가 문안을 그대로 지정했다.
 */
export const INFO_SHEET = {
  positionFormula:
    "현재가보다 낮았던 날의 수와 같았던 날의 절반을 더해, 전체 거래일 수로 나눈 값입니다.",
  trendFormula:
    "최근 20일 종가의 평균과 60일 종가의 평균을 각각 구해 둘을 비교합니다.",
  crossFormula:
    "두 평균선의 위아래가 바뀐 날을 찾습니다. 바뀐 뒤 두 선의 간격이 0.5%에 못 미치면 표시하지 않습니다.",
  highLowNote:
    "캐릭터 위치와 기간 최고가·최저가는 서로 다른 것을 재는 값입니다. 위치는 며칠이 현재가보다 낮았는지를 세고, 최고가·최저가는 그 기간의 양 끝값입니다.",
  source: "데이터 출처: 토스증권 Open API",
  // 아래 두 문장은 PRD §13.3 이 문안을 지정한 필수 한계 고지다.
  // "예측"은 §13.2 금지어이지만, 여기서는 "하지 않는다"는 부정문의 목적어이므로
  // 예외로 허용한다. lint-templates.ts 의 allowlist 에 등록되어 있다.
  limitPosition:
    "가격 범위 내 위치는 과거 데이터의 통계적 요약이며, 미래 가격을 예측하지 않습니다.", // lint-allow: 예측
  limitTrend:
    "이동평균선 교차는 이미 발생한 가격 변화를 사후에 확인하는 지표입니다.",
} as const;

/** 모든 분석 화면 하단 고정 문구 (§13.3, F-LEGAL-01) */
export const DISCLAIMER_BAR =
  "본 정보는 투자 판단의 참고 자료이며, 투자 권유가 아닙니다. 투자의 최종 판단과 책임은 이용자 본인에게 있습니다.";

/** 최초 실행 모달 (§13.3 문안 초안) */
export const FIRST_RUN_MODAL = {
  title: "먼저 확인해 주세요",
  intro:
    "POSTURE는 공개된 시세 데이터를 쉽게 볼 수 있도록 정리해 보여주는 서비스입니다.",
  bullets: [
    "특정 종목의 거래를 권유하지 않습니다.",
    "표시되는 위치와 흐름은 과거 데이터를 요약한 것이며, 앞으로의 가격을 예측하지 않습니다.", // lint-allow: 예측
    "시세는 실시간이 아닐 수 있으며, 실제 거래 가격과 다를 수 있습니다.",
    "투자의 최종 판단과 그 결과에 대한 책임은 이용자 본인에게 있습니다.",
  ],
  source: "데이터 출처: 토스증권 Open API",
  confirm: "확인했습니다",
} as const;
