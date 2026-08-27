/**
 * 일봉 캐시 적재 + 1-1 게이트 검증 (PRD §15 Phase 1-1)
 *
 * 실행:
 *   npm run sync:candles              # 기본 검증 종목 (005930, AAPL)
 *   npm run sync:candles 005930 AAPL 000660
 *
 * PRD 의 1-1 검증 기준은 이것이다:
 *   "삼성전자·AAPL 250봉이 DB에 정확히 적재됨. 토스 웹 차트와 종가 대조 일치"
 *
 * 그래서 이 스크립트는 적재만 하지 않고 **적재 결과를 검사한다.**
 *   - 250봉이 실제로 들어갔는가
 *   - 거래일에 구멍이나 중복이 없는가
 *   - 최신 봉이 '오늘 진행 중인 봉'인가 (§7.1 당일 제외 규칙의 전제)
 *   - DB 를 다시 읽었을 때 받은 값과 일치하는가 (왕복 무결성)
 *
 * 마지막에 종가 대조용 표를 출력한다. 토스 웹 차트와 눈으로 맞추면
 * 1-1 게이트가 닫힌다.
 */

import { closeDbInstance, openDb } from "../src/lib/db/open";
import {
  candleCacheState,
  countCandles,
  getCandles,
  getStock,
  readToken,
  upsertCandles,
  writeToken,
} from "../src/lib/db/repo";
import { setTokenStore } from "../src/lib/toss/core";
import { TARGET_CANDLES, fetchCandles } from "../src/lib/toss/candles";
import { inferMarket, isFormingBar, todayInMarket } from "../src/lib/toss/trading-day";
import { TossApiError, toLogFields } from "../src/lib/toss/errors";
import type { Candle, Market } from "../src/lib/types";

try {
  process.loadEnvFile(".env.local");
} catch {
  // CI 등 환경변수가 이미 주입된 경우
}

/** PRD 1-1 검증 기준이 지정한 두 종목 */
const DEFAULT_SYMBOLS = ["005930", "AAPL"];

const problems: string[] = [];

function check(ok: boolean, label: string): void {
  console.log(`   ${ok ? "✅" : "🔴"} ${label}`);
  if (!ok) problems.push(label);
}

/** 두 배열이 봉 단위로 같은지. 왕복(적재 → 재조회) 무결성 검사 */
function sameCandles(a: readonly Candle[], b: readonly Candle[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((x, i) => {
    const y = b[i]!;
    return (
      x.date === y.date &&
      x.open === y.open &&
      x.high === y.high &&
      x.low === y.low &&
      x.close === y.close &&
      x.volume === y.volume
    );
  });
}

async function syncOne(
  db: NonNullable<ReturnType<typeof openDb>>,
  symbol: string,
): Promise<void> {
  console.log(`\n${"─".repeat(70)}`);

  // 마스터가 있으면 그쪽 market 이 정답이다. 없으면 심볼로 추정한다.
  const master = getStock(db, symbol);
  const market: Market = master?.market ?? inferMarket(symbol);
  const label = master?.name_ko ?? master?.name_en ?? symbol;
  console.log(` ${symbol} — ${label}  [${market}]`);
  console.log("─".repeat(70));

  const fetched = await fetchCandles(symbol, market, TARGET_CANDLES);
  console.log(`   ↳ 토스에서 ${fetched.length}봉 수신`);

  if (fetched.length === 0) {
    check(false, `${symbol}: 봉을 하나도 받지 못했다`);
    return;
  }

  const written = upsertCandles(db, symbol, fetched, new Date().toISOString());
  console.log(`   ↳ DB 에 ${written}봉 UPSERT`);

  // ── 검사 ────────────────────────────────────────────────────────
  check(
    fetched.length === TARGET_CANDLES,
    `${symbol}: ${TARGET_CANDLES}봉 확보 (실제 ${fetched.length}봉)`,
  );

  const dates = fetched.map((c) => c.date);
  check(
    new Set(dates).size === dates.length,
    `${symbol}: 거래일 중복 없음`,
  );

  const ascending = dates.every((d, i) => i === 0 || dates[i - 1]! < d);
  check(ascending, `${symbol}: 거래일 오름차순 정렬`);

  const finite = fetched.every(
    (c) =>
      Number.isFinite(c.open) &&
      Number.isFinite(c.high) &&
      Number.isFinite(c.low) &&
      Number.isFinite(c.close) &&
      Number.isFinite(c.volume),
  );
  check(finite, `${symbol}: 모든 가격·거래량이 유한한 수 (문자열 파싱 성공)`);

  const sane = fetched.every(
    (c) => c.low <= c.open && c.open <= c.high && c.low <= c.close && c.close <= c.high,
  );
  check(sane, `${symbol}: low ≤ open·close ≤ high 성립`);

  // DB 왕복 무결성 — REAL 컬럼이 값을 바꾸지 않았는지
  const roundTrip = getCandles(db, symbol, TARGET_CANDLES);
  check(
    sameCandles(fetched, roundTrip),
    `${symbol}: DB 왕복 후에도 값이 동일 (${roundTrip.length}봉 재조회)`,
  );

  check(
    countCandles(db, symbol) >= fetched.length,
    `${symbol}: price_candle 행 수 ${countCandles(db, symbol)}`,
  );

  // ── 당일 봉 판정 (§7.1 전제 확인) ────────────────────────────────
  const state = candleCacheState(db, symbol);
  const latest = fetched.at(-1)!;
  const today = todayInMarket(market);
  const forming = isFormingBar(latest.date, market);

  console.log(
    `   ↳ 최신 봉 ${latest.date} (종가 ${latest.close.toLocaleString()}) · ` +
      `${market} 현지 오늘 ${today} → ${forming ? "진행 중인 당일 봉" : "마감된 봉"}`,
  );
  console.log(`   ↳ 캐시 기준 시각 ${state?.fetchedAt ?? "(없음)"}`);

  // ── 종가 대조표 (토스 웹 차트와 눈으로 맞춘다) ───────────────────
  console.log(`\n   최근 5거래일 — 토스 웹 차트와 대조하라`);
  console.log(`   ${"거래일".padEnd(12)}${"시가".padStart(12)}${"고가".padStart(12)}${"저가".padStart(12)}${"종가".padStart(12)}${"거래량".padStart(16)}`);
  for (const c of fetched.slice(-5)) {
    console.log(
      `   ${c.date.padEnd(12)}` +
        `${c.open.toLocaleString().padStart(12)}` +
        `${c.high.toLocaleString().padStart(12)}` +
        `${c.low.toLocaleString().padStart(12)}` +
        `${c.close.toLocaleString().padStart(12)}` +
        `${c.volume.toLocaleString().padStart(16)}`,
    );
  }

  console.log(
    `\n   기간: ${fetched[0]!.date} ~ ${latest.date} (${fetched.length}거래일)`,
  );
}

async function main(): Promise<void> {
  const symbols = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const targets = symbols.length > 0 ? symbols : DEFAULT_SYMBOLS;

  console.log("═".repeat(70));
  console.log(" POSTURE — 일봉 캐시 적재 · 1-1 게이트 검증");
  console.log("═".repeat(70));

  const db = openDb();
  if (db === null) {
    console.error("\n🔴 DB 를 열 수 없다. 중단한다.\n");
    process.exit(1);
  }

  setTokenStore({
    read: () => readToken(db),
    write: (t) => writeToken(db, t),
  });

  for (const symbol of targets) {
    try {
      await syncOne(db, symbol);
    } catch (err) {
      if (err instanceof TossApiError) {
        console.error(`\n   🔴 ${symbol} 실패:`, err.message, toLogFields(err));
      } else {
        console.error(`\n   🔴 ${symbol} 실패:`, err);
      }
      problems.push(`${symbol}: 적재 실패`);
    }
  }

  console.log(`\n${"═".repeat(70)}`);
  if (problems.length === 0) {
    console.log(" ✅ 1-1 게이트 자동 검사 통과");
    console.log("");
    console.log("    남은 것은 사람의 확인 하나다 — 위 종가 대조표를 토스 웹");
    console.log("    차트와 맞춰보라. 일치하면 1-2 지표 엔진으로 넘어가도 된다.");
  } else {
    console.log(` 🔴 문제 ${problems.length}건`);
    for (const p of problems) console.log(`    - ${p}`);
    process.exitCode = 1;
  }
  console.log("═".repeat(70) + "\n");

  closeDbInstance();
}

main().catch((err: unknown) => {
  console.error("\n예상치 못한 오류:", err);
  closeDbInstance();
  process.exit(1);
});
