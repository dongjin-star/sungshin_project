/**
 * 종목 마스터 동기화 배치 (PRD §8.1 F-SEARCH-01, Phase 1-1)
 *
 * 실행: npm run sync:master
 *
 * ── 2단계 구성 (Phase 0-4 실측으로 확정) ───────────────────────────
 *
 *   [1] GET /stocks/all?market={7개 세그먼트}   STOCK_ALL  1 TPS
 *       → 심볼 목록. 실측 15,272종목.
 *       ⚠️ market 은 필수 파라미터다. PRD §8.1 이 단일 호출로 적은 것은
 *          실측과 다르며, 세그먼트 수만큼 호출해야 한다.
 *
 *   [2] GET /stocks?symbols={200개씩}           STOCK      5 TPS
 *       → englishName·currency·status·sharesOutstanding 을 채운다.
 *          /stocks/all 은 symbol·name·securityType·isCommonShare·isinCode
 *          만 주므로, 스키마의 name_en·currency·shares_out 을 채우려면
 *          이 단계가 필요하다. F-SEARCH-02(영문 검색)의 근거 데이터다.
 *
 * 약 77회 × 5 TPS ≈ 16초. 일 1회 배치이므로 충분히 여유롭다.
 *
 * 🔴 STOCK_ALL 은 1 TPS 다. 이 스크립트를 사용자 요청 경로에서 부르지 마라.
 */

import { closeDbInstance, openDb } from "../src/lib/db/open";
import {
  markMissingAsDelisted,
  readToken,
  upsertStocks,
  writeToken,
  type StockRow,
} from "../src/lib/db/repo";
import { setTokenStore } from "../src/lib/toss/core";
import {
  MARKET_SEGMENTS,
  SYMBOLS_PER_CALL,
  fetchListedStocks,
  fetchStockInfos,
  marketOf,
  type MarketSegment,
  type StockInfo,
} from "../src/lib/toss/endpoints";
import { toInitials } from "../src/lib/hangul";
import { writeSearchIndex } from "./build-search-index";
import { DB_SEED_PATH, writeDbSeed } from "../src/lib/service/db-seed";
import { TossApiError, toLogFields } from "../src/lib/toss/errors";

try {
  process.loadEnvFile(".env.local");
} catch {
  // CI 등 환경변수가 이미 주입된 경우
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * 토스 status → 스키마 listing_status.
 *
 * SCHEDULED(상장 예정)를 SUSPENDED 로 넣는 것은 의미가 다르지만, 어느
 * 쪽이든 "지금 거래할 수 없다"는 점에서 §12.1 의 처리 경로가 같다.
 * 상장 예정 종목을 검색 결과에 노출하지 않는 것이 목적이다.
 */
function listingStatusOf(status: StockInfo["status"]): StockRow["listing_status"] {
  if (status === "ACTIVE") return "LISTED";
  if (status === "DELISTED") return "DELISTED";
  return "SUSPENDED";
}

/**
 * StockInfo → 스키마 행.
 *
 * 실측: 토스 `name` 은 미국 종목에도 한글 표기를 준다("아포지 애퀴지션").
 * 그래서 name_ko 는 시장과 무관하게 채우고, 한글이 없으면 null 로 둔다.
 * 초성 인덱스도 마찬가지로 미국 종목에 붙는다 — "ㅇㅍㅈ" 로 US 종목이
 * 검색되는 것은 버그가 아니라 F-SEARCH-03 의 이득이다.
 */
function toRow(info: StockInfo, syncedAt: string): StockRow {
  const hasHangul = /[가-힣]/.test(info.name);
  const shares = Number(info.sharesOutstanding);

  return {
    symbol: info.symbol,
    name_ko: hasHangul ? info.name : null,
    name_en: info.englishName ?? (hasHangul ? null : info.name),
    initials: hasHangul ? toInitials(info.name) : null,
    market: marketOf(info.market),
    exchange: info.market,
    currency: info.currency,
    listing_status: listingStatusOf(info.status),
    shares_out: Number.isFinite(shares) && shares > 0 ? Math.trunc(shares) : null,
    security_type: info.securityType,
    is_common_share: info.isCommonShare ? 1 : 0,
    synced_at: syncedAt,
  };
}

async function main(): Promise<void> {
  console.log("═".repeat(70));
  console.log(" POSTURE — 종목 마스터 동기화 (Phase 1-1)");
  console.log("═".repeat(70));

  const db = openDb();
  if (db === null) {
    console.error("\n🔴 DB 를 열 수 없다. 마스터 동기화는 캐시가 전제다. 중단한다.\n");
    process.exit(1);
  }

  // 프로세스 재시작에도 토큰을 재사용한다 (AUTH 5 TPS 절약)
  setTokenStore({
    read: () => readToken(db),
    write: (t) => writeToken(db, t),
  });

  const syncedAt = new Date().toISOString();

  // ── [1] 세그먼트별 심볼 목록 ──────────────────────────────────────
  console.log("\n[1] 심볼 목록 수집  (STOCK_ALL · 1 TPS)");
  const symbols: string[] = [];
  const perSegment: string[] = [];

  for (const segment of MARKET_SEGMENTS) {
    const listed = await fetchListedStocks(segment as MarketSegment);
    symbols.push(...listed.map((s) => s.symbol));
    perSegment.push(`${segment}=${listed.length}`);
    console.log(`   ↳ ${segment.padEnd(7)} ${String(listed.length).padStart(6)}종목`);
  }

  // 세그먼트 간 중복은 없어야 하지만, 있어도 뒤 호출이 이긴다
  const unique = [...new Set(symbols)];
  console.log(`   ↳ 합계 ${unique.length.toLocaleString()}종목 (${perSegment.join(", ")})`);

  if (unique.length === 0) {
    console.error("\n🔴 심볼을 하나도 받지 못했다. 마스터를 덮어쓰지 않고 중단한다.\n");
    process.exit(1);
  }

  // ── [2] 상세 조회 + 적재 ──────────────────────────────────────────
  const batches = chunk(unique, SYMBOLS_PER_CALL);
  console.log(
    `\n[2] 상세 조회 · 적재  (STOCK · 5 TPS · ${batches.length}회 호출)`,
  );

  let upserted = 0;
  let failed = 0;

  for (const [i, batch] of batches.entries()) {
    try {
      const infos = await fetchStockInfos(batch);
      upserted += upsertStocks(
        db,
        infos.map((info) => toRow(info, syncedAt)),
      );
    } catch (err) {
      // 한 배치 실패로 전체를 버리지 않는다. 남은 종목은 다음 배치가 채운다.
      failed += batch.length;
      if (err instanceof TossApiError) {
        console.error(`   🔴 배치 ${i + 1} 실패`, toLogFields(err));
      } else {
        console.error(`   🔴 배치 ${i + 1} 실패:`, err instanceof Error ? err.message : err);
      }
    }

    if ((i + 1) % 10 === 0 || i === batches.length - 1) {
      console.log(
        `   ↳ ${String(i + 1).padStart(3)}/${batches.length} 배치 · ` +
          `${upserted.toLocaleString()}종목 적재${failed > 0 ? ` · ${failed}종목 실패` : ""}`,
      );
    }
  }

  // ── [3] 사라진 종목 정리 ──────────────────────────────────────────
  //
  // 이번 동기화에서 한 번도 갱신되지 않은 행 = 목록에서 빠진 종목.
  // 대량 실패가 있었다면 멀쩡한 종목까지 상장폐지로 표시될 수 있으므로
  // 실패가 있으면 건너뛴다.
  console.log("\n[3] 목록에서 빠진 종목 정리");
  if (failed > 0) {
    console.log(
      `   ⏭️  ${failed}종목이 실패했다. 오탐 방지를 위해 상장폐지 표시를 건너뛴다.`,
    );
  } else {
    const delisted = markMissingAsDelisted(db, syncedAt);
    console.log(`   ↳ ${delisted.toLocaleString()}종목을 DELISTED 로 표시`);
  }

  // ── [4] 검색 인덱스 재생성 ────────────────────────────────────────
  //
  // 마스터가 바뀌었으니 인덱스도 다시 굽는다 (D-04). 배치와 인덱스가
  // 따로 놀면 검색 결과에만 없는 종목이 생긴다.
  console.log("\n[4] 검색 인덱스 생성");
  writeSearchIndex();

  // ── [5] 종목 마스터 스냅샷 (Vercel 배포용) ─────────────────────────
  //
  // Vercel 서버리스는 콜드스타트마다 DB가 비어 있다 (§10.3-a). 이 스냅샷이
  // 없으면 마스터가 매 배포마다 빈 채로 시작해 모든 종목이 "알 수 없음"이
  // 된다. 검색 인덱스와 같은 시점에 같이 구워야 둘이 어긋나지 않는다.
  console.log("\n[5] 종목 마스터 스냅샷 생성 (Vercel 배포용)");
  if (failed > 0) {
    console.log("   ⏭️  이번 동기화에 실패가 있었다. 스냅샷은 다음 성공한 동기화에서 갱신한다.");
  } else {
    const { count } = writeDbSeed(db);
    console.log(`   ↳ ${DB_SEED_PATH} — ${count.toLocaleString()}종목`);
  }

  console.log(`\n${"═".repeat(70)}`);
  console.log(` 완료 — ${upserted.toLocaleString()}종목 적재${failed > 0 ? `, ${failed}종목 실패` : ""}`);
  console.log("═".repeat(70) + "\n");

  closeDbInstance();
  if (failed > 0) process.exitCode = 1;
}

main().catch((err: unknown) => {
  if (err instanceof TossApiError) {
    console.error("\n🔴 마스터 동기화 실패:", err.message, toLogFields(err));
  } else {
    console.error("\n🔴 마스터 동기화 실패:", err);
  }
  closeDbInstance();
  process.exit(1);
});
