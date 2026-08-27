/**
 * 검색 매칭·랭킹 (PRD F-SEARCH-01/03, §5.2)
 *
 * 순수 함수다 — 네트워크도 DOM 도 만지지 않는다. 인덱스 배열과 질의를
 * 넣으면 정렬된 결과가 나온다. 검색 품질은 이 파일이 전부 결정하므로
 * 테스트로 고정한다.
 *
 * D-04 가 전량 클라이언트 로드를 택했으므로 이 함수들은 브라우저에서
 * 15,272건을 훑는다. 한 번의 선형 스캔으로 끝나도록 짰다 — 질의마다
 * 인덱스를 재구성하거나 정규화를 반복하지 않는다.
 */

import { isInitialsOnly, normalize } from "../hangul";
import type { Market } from "../types";
import type { SearchIndexTuple } from "../service/search-index";

export interface SearchEntry {
  symbol: string;
  nameKo: string | null;
  nameEn: string | null;
  initials: string | null;
  market: Market;
  /**
   * 인덱스 배열에서의 위치 = **종목 중요도 순위**.
   *
   * 배치가 인덱스를 보통주·발행주식수 순으로 구워서 내려주므로
   * (search-index.ts 의 ORDER BY 참조), 여기서는 위치를 그대로 쓰면 된다.
   * 점수를 따로 실어 페이로드를 키우지 않기 위한 장치다.
   */
  rank: number;
  /** 사전 정규화. 질의마다 다시 만들지 않으려고 인덱스 로드 시 한 번만 계산한다 */
  normSymbol: string;
  normKo: string;
  normEn: string;
  normInitials: string;
}

/**
 * 튜플 → 검색용 엔트리.
 *
 * 정규화를 여기서 한 번만 해둔다. 15,272건 × 질의마다 `toLowerCase` 를
 * 다시 도는 것과, 로드 시 한 번 도는 것의 차이는 타이핑 반응 속도로 나온다.
 */
export function toSearchEntries(items: readonly SearchIndexTuple[]): SearchEntry[] {
  return items.map(([symbol, nameKo, nameEn, initials, market], rank) => ({
    symbol,
    nameKo,
    nameEn,
    initials,
    market,
    rank,
    normSymbol: normalize(symbol),
    normKo: nameKo === null ? "" : normalize(nameKo),
    normEn: nameEn === null ? "" : normalize(nameEn),
    normInitials: initials === null ? "" : initials.replace(/\s/g, ""),
  }));
}

/**
 * 점수. **낮을수록 먼저** 나온다.
 *
 * 순위 근거는 "사용자가 이미 아는 종목을 특정하러 왔다"는 §5.2 의 목적이다.
 * 그래서 완전일치 > 접두사 > 부분포함 순으로 가르고, 같은 등급 안에서는
 * 이름이 짧은 쪽을 올린다 — "삼성전자"가 "삼성전자우"보다 위여야 한다.
 */
const EXACT = 0;
const PREFIX = 100;
const CONTAINS = 200;
const NO_MATCH = Number.POSITIVE_INFINITY;

function rank(haystack: string, needle: string): number {
  if (haystack.length === 0) return NO_MATCH;
  if (haystack === needle) return EXACT;
  if (haystack.startsWith(needle)) return PREFIX;
  const at = haystack.indexOf(needle);
  return at === -1 ? NO_MATCH : CONTAINS + at;
}

/**
 * 엔트리 하나의 점수. 어느 필드에서 맞았는지에 따라 가중치가 다르다.
 *
 * 티커를 이름보다 우선하는 이유: "005930" 이나 "AAPL" 을 친 사람은
 * 그 종목을 정확히 지목한 것이다. 반면 "삼성"은 여러 종목에 걸린다.
 *
 * **맞은 필드의 길이를 같이 돌려준다.** 동점일 때 이걸로 가른다.
 * 한글명 길이로 가르면 "samsung" 질의에서 삼성전자·삼성화재·삼성제약이
 * 전부 4자라 갈리지 않고, 심볼 순으로 밀려 삼성화재가 1위가 된다.
 * 실제로 걸린 이름("SamsungElec" 11자 < "SamsungF&MIns" 13자)으로
 * 재야 사용자가 친 단어에 가장 가까운 종목이 위로 온다.
 */
interface Score {
  value: number;
  /** 점수를 만든 필드의 길이 */
  matchedLength: number;
}

const NO_SCORE: Score = { value: NO_MATCH, matchedLength: 0 };

function scoreEntry(entry: SearchEntry, q: string, initialsMode: boolean): Score {
  if (initialsMode) {
    // 초성 질의는 초성 필드로만 판단한다. "ㅅㅅ"이 영문명에 걸릴 일은 없다.
    const r = rank(entry.normInitials, q);
    return r === NO_MATCH ? NO_SCORE : { value: r, matchedLength: entry.normInitials.length };
  }

  const candidates: Score[] = [
    // 티커 일치에 -50 을 줘서 같은 등급이면 티커가 이긴다
    { value: rank(entry.normSymbol, q) - 50, matchedLength: entry.normSymbol.length },
    { value: rank(entry.normKo, q), matchedLength: entry.normKo.length },
    { value: rank(entry.normEn, q), matchedLength: entry.normEn.length },
  ];

  let best = NO_SCORE;
  for (const c of candidates) {
    if (!Number.isFinite(c.value)) continue;
    if (c.value < best.value) best = c;
  }

  return best;
}

/** 이름 길이. 맞은 필드 길이까지 같을 때의 마지막 직전 기준 */
function nameLength(entry: SearchEntry): number {
  return (entry.nameKo ?? entry.nameEn ?? entry.symbol).length;
}

export interface SearchOptions {
  /** 시장 필터 칩 (§5.2). null 이면 전체 */
  market?: Market | null;
  limit?: number;
}

/** §5.2 결과 리스트. 시세를 1회 호출로 받을 수 있는 상한 안에 둔다 */
export const DEFAULT_LIMIT = 30;

/**
 * 검색 실행.
 *
 * 질의가 초성만으로 되어 있으면 초성 모드로 전환한다 (F-SEARCH-03).
 * "ㅅㅅㅈㅈ" 는 초성 필드에서만 찾고, "삼성" 은 이름·티커에서 찾는다.
 */
export function search(
  entries: readonly SearchEntry[],
  query: string,
  options: SearchOptions = {},
): SearchEntry[] {
  const { market = null, limit = DEFAULT_LIMIT } = options;

  const initialsMode = isInitialsOnly(query);
  // 초성 질의는 소문자화 대상이 아니다. 공백만 걷어낸다.
  const q = initialsMode ? query.replace(/\s/g, "") : normalize(query);

  if (q.length === 0) return [];

  const hits: { entry: SearchEntry; score: Score }[] = [];

  for (const entry of entries) {
    if (market !== null && entry.market !== market) continue;

    const score = scoreEntry(entry, q, initialsMode);
    if (!Number.isFinite(score.value)) continue;

    hits.push({ entry, score });
  }

  hits.sort((a, b) => {
    if (a.score.value !== b.score.value) return a.score.value - b.score.value;

    // 같은 점수면 더 중요한 종목부터. 이게 이름 길이보다 앞서야 한다 —
    // "samsung" 은 삼성물산·삼성E&A·삼성전자가 전부 접두사 일치라
    // 글자 수로 가르면 영문명이 1자 짧은 삼성물산이 1위가 된다.
    if (a.entry.rank !== b.entry.rank) return a.entry.rank - b.entry.rank;

    // 중요도가 같을 때(둘 다 발행주식수 미상 등) 쓰는 보조 기준
    const matchedDiff = a.score.matchedLength - b.score.matchedLength;
    if (matchedDiff !== 0) return matchedDiff;

    const lengthDiff = nameLength(a.entry) - nameLength(b.entry);
    if (lengthDiff !== 0) return lengthDiff;

    // 마지막 기준은 심볼이다. 정렬이 입력마다 흔들리면 안 된다.
    return a.entry.symbol.localeCompare(b.entry.symbol);
  });

  return hits.slice(0, limit).map((h) => h.entry);
}
