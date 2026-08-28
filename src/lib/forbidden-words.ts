/**
 * 표현 금지어 목록 (PRD §13.2, §7.6 R-05)
 *
 * `scripts/lint-templates.ts` 가 빌드 시점에 소스 문자열 리터럴을 검사할 때,
 * 그리고 `src/lib/ai/plain-explanation.ts` 가 런타임에 Gemini 응답을 검사할
 * 때 — 둘이 같은 목록을 쓴다. 목록이 갈라지면 "AI가 만든 문장은 못 걸러내는
 * 금지어가 생긴다"는 사고가 난다.
 *
 * 이 배열을 줄이려면 PRD §13.2 를 먼저 고쳐야 한다.
 */
export const FORBIDDEN_WORDS: readonly string[] = [
  // 매매 행위
  "매수", "매도", "사다", "팔다", "사세요", "파세요",
  "진입", "청산", "익절", "손절",
  // 권유·가치 판단
  "추천", "유망", "기회", "타이밍", "적기", "좋은 위치", "나쁜 위치",
  // 가격 평가
  "저평가", "고평가", "싸다", "비싸다", "저렴", "부담",
  // 위치 은유 오용
  "저점", "고점", "바닥", "천장", "무릎에서", "어깨에서",
  // 예측
  "목표가", "적정가", "전망", "예상", "예측", "상승할", "하락할",
  // 투자 맥락의 경고어.
  // §13.2 단서: "거래정지 배지 등 사실 표시는 예외" → 소스 린트는 lint-allow 주석으로,
  // 런타임 검사는 이 단어를 아예 대상에서 빼는 방식으로 개별 허용한다.
  "주의", "위험",
];

/** 속담 전체는 마케팅 카피 포함 어디에도 등장할 수 없다 (§13.2, L-06) */
export const FORBIDDEN_PHRASES: readonly string[] = [
  "무릎에서 사서",
  "어깨에서 팔",
];

/**
 * 런타임(=AI 응답) 검사용. 소스 린트와 달리 `lint-allow` 주석 같은 예외
 * 통로가 없으므로, 사실 표시로 자주 쓰이는 "주의"/"위험"은 아예 검사
 * 대상에서 뺀다 — 이 둘은 §13.2 도 예외를 인정한 단어들이다.
 */
const RUNTIME_CHECK_WORDS = FORBIDDEN_WORDS.filter((w) => w !== "주의" && w !== "위험");

/** 금지 표현이 있으면 그중 하나를 반환하고, 없으면 null. */
export function findForbiddenExpression(text: string): string | null {
  for (const phrase of FORBIDDEN_PHRASES) {
    if (text.includes(phrase)) return phrase;
  }
  for (const word of RUNTIME_CHECK_WORDS) {
    if (text.includes(word)) return word;
  }
  return null;
}
