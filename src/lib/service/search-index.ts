/**
 * 검색 인덱스 빌드 (PRD D-04 — 전량 클라이언트 로드 결정)
 *
 * D-04 실측: 전체 15,272종목을 튜플로 직렬화하면 원본 1,190KB,
 * gzip 336KB, brotli 265KB. 진입 후 한 번 받아 캐시하면 이후 검색은
 * 네트워크 0회다.
 *
 * 튜플로 내리는 이유는 압축률보다 **원본 크기**다. 압축 후 차이는
 * 372KB → 336KB 로 크지 않지만, 원본이 2,205KB → 1,190KB 로 줄면
 * 클라이언트의 JSON 파싱 시간과 메모리가 그만큼 준다. 초보자의
 * 저사양 단말을 가정하면 이쪽이 실제로 체감된다.
 *
 * ── 왜 API 라우트가 아니라 정적 산출물인가 (실측) ──────────────────
 *
 * `next start` 는 **라우트 핸들러 응답을 압축하지 않는다.** 페이지 HTML 과
 * `public/` 정적 파일에는 gzip 이 걸리는데, Route Handler 응답에는 걸리지
 * 않고 우리가 `Content-Encoding` 을 직접 붙여도 Next 가 지운다.
 *
 *   GET /api/search-index  → 1,218,732 bytes, Content-Encoding 없음
 *   GET /search-index.json → gzip 적용됨
 *
 * D-04 는 265~336KB 를 전제로 전량 로드를 택한 결정이다. 압축이 빠지면
 * 1.19MB 가 되어 근거가 4.5배 어긋난다. 그래서 인덱스는 마스터 배치가
 * `public/search-index.json` 으로 굽고, Next 의 정적 파일 경로로 내보낸다.
 * ETag·Last-Modified 도 정적 핸들러가 붙여준다.
 *
 * 부수 효과로 §11.4 가 더 깨끗해진다 — 정적 파일이라 상류 부담이 0이고
 * rate limiting 대상에서 빠진다.
 */

import type { Database } from "better-sqlite3";

import type { Market } from "../types";

/** `[symbol, nameKo, nameEn, initials, market]` */
export type SearchIndexTuple = [
  string,
  string | null,
  string | null,
  string | null,
  Market,
];

export interface SearchIndexPayload {
  /** 마스터 배치 시각. 클라이언트가 캐시 무효화 판단에 쓴다 */
  syncedAt: string;
  count: number;
  /** 튜플 필드 순서. 클라이언트가 인덱스를 하드코딩하지 않게 명시한다 */
  fields: ["symbol", "nameKo", "nameEn", "initials", "market"];
  items: SearchIndexTuple[];
}

/** 배치가 굽는 위치. 클라이언트는 `/search-index.json` 으로 받는다 */
export const SEARCH_INDEX_PATH = "public/search-index.json";

/**
 * 상장 종목 전량을 튜플 배열로.
 *
 * 상장폐지·상장예정은 제외한다. 검색 결과에 나오면 사용자가 조회했을 때
 * 캔들이 없어 빈 화면이 되고, 그건 §12.1 이 피하려는 상황이다.
 */
export function buildSearchIndex(db: Database): SearchIndexPayload {
  const rows = db
    .prepare<
      [],
      {
        symbol: string;
        name_ko: string | null;
        name_en: string | null;
        initials: string | null;
        market: Market;
        synced_at: string;
      }
    >(
      // ── 정렬이 곧 랭킹이다 (§5.2) ────────────────────────────────
      //
      // 배열 순서를 **종목 중요도 순**으로 굽는다. 검색이 동점을 만났을 때
      // 이 순서를 타이브레이크로 쓰면 되므로, 점수 컬럼을 따로 실어
      // 페이로드를 키울 필요가 없다 (0바이트 추가).
      //
      // 왜 필요한가: 실측에서 "samsung" 이 삼성물산을 1위로 냈다.
      // 이름 길이로 가르면 "SamsungC&T"(10자)가 "SamsungElec"(11자)을
      // 이기기 때문이다. 글자 수는 사용자가 찾는 종목과 아무 상관이 없다.
      //
      //   1순위 — 보통주 일반 종목이 ETF·ETN·우선주보다 위.
      //           "테슬라" 를 친 사람은 TSLA 를 찾는 것이지
      //           "PLUS 테슬라위클리커버드콜채권혼합" 을 찾는 게 아니다.
      //   2순위 — 발행주식수. 회사 규모의 대용치다. 완벽하지 않지만
      //           (저가 대량발행주가 과대평가된다) 글자 수보다는
      //           비교할 수 없이 낫고, 이미 마스터에 있는 값이다.
      `SELECT symbol, name_ko, name_en, initials, market, synced_at
         FROM stock
        WHERE listing_status = 'LISTED'
        ORDER BY
          CASE
            WHEN security_type = 'STOCK' AND is_common_share = 1 THEN 0
            WHEN security_type = 'STOCK'                        THEN 1
            WHEN security_type IN ('ETF', 'ETN')                THEN 3
            ELSE 2
          END,
          COALESCE(shares_out, 0) DESC,
          symbol`,
    )
    .all();

  let syncedAt = "";
  const items: SearchIndexTuple[] = rows.map((r) => {
    if (r.synced_at > syncedAt) syncedAt = r.synced_at;
    return [r.symbol, r.name_ko, r.name_en, r.initials, r.market];
  });

  return {
    syncedAt,
    count: items.length,
    fields: ["symbol", "nameKo", "nameEn", "initials", "market"],
    items,
  };
}
