/**
 * 한글 초성 처리 (PRD F-SEARCH-03)
 *
 * "ㅅㅅㅈㅈ" → 삼성전자. PRD가 "한국 사용자에게 사실상 필수"로 지정한 기능이다.
 *
 * 초성 문자열은 종목 마스터 동기화 시 사전 계산해 `stock.initials` 에 저장한다
 * (§8.1). 검색할 때마다 수천 종목의 초성을 뽑는 건 낭비다.
 */

/** 유니코드 한글 음절 블록 */
const SYLLABLE_BASE = 0xac00;
const SYLLABLE_LAST = 0xd7a3;
/** 중성 21개 × 종성 28개 */
const JUNG_JONG = 21 * 28;

/** 초성 19자 (유니코드 배열 순서) */
const CHOSEONG = [
  "ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ",
  "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ",
] as const;

/** 호환 자모(ㄱ~ㅎ) 범위 — 사용자가 직접 입력하는 초성 */
const COMPAT_JAMO_START = 0x3131;
const COMPAT_JAMO_END = 0x314e;

/**
 * 문자열의 초성을 추출한다.
 *
 * 한글 음절이 아닌 문자(영문·숫자·공백·기호)는 **그대로 남긴다.**
 * "SK하이닉스" → "SKㅎㄴㄷㅅ" 처럼 섞인 종목명이 흔하기 때문이다.
 */
export function toInitials(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code >= SYLLABLE_BASE && code <= SYLLABLE_LAST) {
      const index = Math.floor((code - SYLLABLE_BASE) / JUNG_JONG);
      out += CHOSEONG[index]!;
    } else {
      out += ch;
    }
  }
  return out;
}

/** 입력이 초성만으로 이루어졌는가 — 초성 검색 모드로 전환할지 판단한다 */
export function isInitialsOnly(query: string): boolean {
  const trimmed = query.replace(/\s/g, "");
  if (trimmed.length === 0) return false;
  for (const ch of trimmed) {
    const code = ch.codePointAt(0)!;
    if (code < COMPAT_JAMO_START || code > COMPAT_JAMO_END) return false;
  }
  return true;
}

/**
 * 검색 정규화. 대소문자·공백·하이픈을 무시한다.
 * "삼성 전자" 와 "삼성전자", "BRK-B" 와 "brk b" 가 같은 것으로 취급된다.
 */
export function normalize(text: string): string {
  return text.toLowerCase().replace(/[\s.\-_]/g, "");
}
