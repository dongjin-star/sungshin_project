/**
 * Phase 0-4 — 토스증권 Open API 응답 실측 (PRD §15 Phase 0)
 *
 * PRD가 "하나라도 예상과 다르면 §7·§8이 수정되어야 한다"고 지정한 게이트다.
 * 지표 엔진을 만들기 전에 아래 3가지를 반드시 눈으로 확인한다.
 *
 *   ① /stocks/all 이 한글 종목명을 제공하는가        → F-SEARCH-01/03 성립 여부
 *   ② before 페이지네이션으로 250봉 소급이 가능한가   → §8.2 성립 여부
 *   ③ 미국 종목 캔들 응답의 타임존 처리              → §7.1 거래일 인덱싱
 *
 * 추가로 D-04(검색 인덱스를 클라이언트 전량 로드할지) 판단 근거인
 * 전체 종목 수를 센다.
 *
 * 원시 응답은 docs/probe/ 에 저장된다 (.gitignore 처리됨).
 *
 * 실행: npm run probe
 *
 * ⚠️ 이 스크립트는 의도적으로 lib/ 에 의존하지 않는다.
 *    실측 결과에 따라 lib/toss 의 설계가 바뀔 수 있으므로, 검증 도구가
 *    검증 대상에 의존하면 안 된다.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

try {
  process.loadEnvFile(".env.local");
} catch {
  // .env.local 이 없으면 이미 주입된 환경변수를 사용한다
}

const BASE = process.env.TOSS_API_BASE ?? "https://openapi.tossinvest.com";
const CLIENT_ID = process.env.TOSS_CLIENT_ID;
const CLIENT_SECRET = process.env.TOSS_CLIENT_SECRET;

const OUT_DIR = join(process.cwd(), "docs", "probe");

/** 실측 결과 요약. 스크립트 끝에서 한 번에 출력한다. */
const findings: string[] = [];

function save(name: string, data: unknown): void {
  const path = join(OUT_DIR, `${name}.json`);
  writeFileSync(path, JSON.stringify(data, null, 2), "utf8");
  console.log(`   ↳ 저장: docs/probe/${name}.json`);
}

function fail(step: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`\n❌ [${step}] 실패: ${msg}`);
  findings.push(`❌ ${step}: ${msg}`);
}

/**
 * 토스 API 호출. 에러 응답은 §11.3 매핑 대상이지만 여기서는 진단이 목적이므로
 * 원문을 그대로 보여준다. (프로덕션 코드에서는 절대 이렇게 하지 않는다)
 */
async function call(
  token: string,
  path: string,
): Promise<{ status: number; headers: Record<string, string>; body: unknown }> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });

  // Rate limit 헤더는 §8.4 토큰 버킷 설계의 근거가 되므로 같이 기록한다
  const headers: Record<string, string> = {};
  for (const key of [
    "x-ratelimit-limit",
    "x-ratelimit-remaining",
    "x-ratelimit-reset",
    "retry-after",
    "x-request-id",
  ]) {
    const v = res.headers.get(key);
    if (v !== null) headers[key] = v;
  }

  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = { __raw: text.slice(0, 2000) };
  }

  if (!res.ok) {
    throw new Error(
      `HTTP ${res.status} — ${JSON.stringify(body).slice(0, 500)}` +
        (res.status === 403
          ? "\n\n   🔴 403은 대개 '허용 IP 미등록'이다. 토스 WTS > 설정 > Open API > IP 관리에" +
            "\n      이 머신의 아웃바운드 IP를 등록했는지 확인하라."
          : ""),
    );
  }

  return { status: res.status, headers, body };
}

/** POST /oauth2/token — client_credentials 그랜트 (AUTH 그룹, 5 TPS) */
async function getToken(): Promise<string> {
  const res = await fetch(`${BASE}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: CLIENT_ID!,
      client_secret: CLIENT_SECRET!,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} — ${text.slice(0, 500)}`);
  }

  const json = JSON.parse(text) as { access_token?: string; expires_in?: number };
  if (typeof json.access_token !== "string") {
    throw new Error(`응답에 access_token 이 없다: ${text.slice(0, 300)}`);
  }

  // 🔒 토큰 값 자체는 절대 출력하지 않는다 (PRD §11.1)
  console.log(`   ↳ access_token 발급됨 (expires_in=${json.expires_in ?? "?"}초)`);
  findings.push(`✅ 인증: 토큰 발급 성공 (expires_in=${json.expires_in ?? "?"})`);
  return json.access_token;
}

/** 객체에서 한글이 담긴 필드를 찾는다 — ①번 확인용 */
function findHangulFields(obj: unknown, prefix = ""): string[] {
  if (obj === null || typeof obj !== "object") return [];
  const hits: string[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string" && /[가-힣]/.test(v)) hits.push(`${path}="${v}"`);
    else if (v !== null && typeof v === "object") hits.push(...findHangulFields(v, path));
  }
  return hits;
}

/** 응답 어디에 배열이 들어있는지 찾는다 (envelope 형태를 모르므로) */
function findArray(body: unknown): unknown[] | null {
  if (Array.isArray(body)) return body;
  if (body === null || typeof body !== "object") return null;
  for (const v of Object.values(body as Record<string, unknown>)) {
    const found = findArray(v);
    if (found !== null) return found;
  }
  return null;
}

async function main(): Promise<void> {
  console.log("═".repeat(70));
  console.log(" POSTURE — Phase 0-4 토스증권 API 실측");
  console.log("═".repeat(70));

  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error(
      "\n🔴 TOSS_CLIENT_ID / TOSS_CLIENT_SECRET 이 없다.\n" +
        "   .env.example 을 .env.local 로 복사하고 값을 채운 뒤 다시 실행하라.\n",
    );
    process.exit(1);
  }

  mkdirSync(OUT_DIR, { recursive: true });

  // 아웃바운드 IP — 403 디버깅의 출발점
  console.log("\n[0] 아웃바운드 IP 확인");
  try {
    const ip = (await (await fetch("https://api.ipify.org", { signal: AbortSignal.timeout(10_000) })).text()).trim();
    console.log(`   ↳ 이 머신의 아웃바운드 IP: ${ip}`);
    console.log("   ↳ 이 IP가 토스 WTS > 설정 > Open API > IP 관리에 등록되어 있어야 한다.");
    findings.push(`ℹ️  아웃바운드 IP: ${ip} (토스 WTS 허용 IP에 등록 필요)`);
  } catch (err) {
    fail("아웃바운드 IP 확인", err);
  }

  // ── 인증 ──────────────────────────────────────────────────────────
  console.log("\n[1] POST /oauth2/token");
  let token: string;
  try {
    token = await getToken();
  } catch (err) {
    fail("토큰 발급", err);
    console.error("\n토큰 없이는 나머지를 진행할 수 없다. 중단한다.\n");
    process.exit(1);
  }

  // ── ① 종목 마스터: 한글명 제공 여부 + 전체 종목 수 ────────────────
  //
  // ⚠️ 실측 결과 /stocks/all 은 market 이 **필수** 쿼리 파라미터다 (미지정 시 400
  //    invalid-request field=market). 즉 전체 마스터는 단일 호출이 아니라
  //    마켓 수만큼의 호출로 구성된다. STOCK_ALL 은 1 TPS 이므로 호출 간 간격을
  //    반드시 벌려야 한다 — §8.3 배치 설계가 이 전제 위에 서 있다.
  const MARKETS = ["KOSPI", "KOSDAQ", "NYSE", "NASDAQ", "AMEX", "KR_ETC", "US_ETC"] as const;

  console.log("\n[2] GET /api/v1/stocks/all?market=…  (STOCK_ALL, 1 TPS — 일 1회 배치 전용)");
  let totalCount = 0;
  let hangulHit: string[] = [];
  let masterFields = "";
  const perMarket: string[] = [];

  for (const market of MARKETS) {
    try {
      // 1 TPS. 앞 호출과 겹치지 않도록 매 호출 전에 여유를 둔다.
      await sleep(1_200);
      const { headers, body } = await call(token, `/api/v1/stocks/all?market=${market}`);
      save(`stocks-all-${market}`, body);

      const arr = findArray(body) ?? [];
      const sample = arr[0];
      totalCount += arr.length;
      perMarket.push(`${market}=${arr.length}`);

      console.log(`   ↳ ${market.padEnd(7)} ${String(arr.length).padStart(6)}종목` +
        (Object.keys(headers).length > 0 ? `  rate-limit=${JSON.stringify(headers)}` : ""));

      if (!masterFields && sample) {
        masterFields = Object.keys(sample as object).join(", ");
        console.log(`   ↳ 항목 필드: ${masterFields}`);
        console.log(`   ↳ 샘플: ${JSON.stringify(sample)}`);
      }

      // ① 한글 종목명 제공 여부 — 국내 마켓에서만 판정한다
      if (hangulHit.length === 0 && market.startsWith("KO")) {
        hangulHit = sample ? findHangulFields(sample) : [];
        if (hangulHit.length === 0) {
          const withHangul = arr.slice(0, 500).find((it) => findHangulFields(it).length > 0);
          if (withHangul) hangulHit = findHangulFields(withHangul);
        }
      }
    } catch (err) {
      fail(`② /stocks/all?market=${market}`, err);
    }
  }

  if (totalCount > 0) {
    findings.push(`✅ ② /stocks/all 은 market 별 호출 (${perMarket.join(", ")})`);
    findings.push(`ℹ️  ② 마스터 항목 필드: ${masterFields}`);
  }

  if (hangulHit.length > 0) {
    console.log(`   ✅ ① 한글 종목명 있음 → ${hangulHit.join(", ")}`);
    findings.push(`✅ ① /stocks/all 한글명 제공: ${hangulHit.join(", ")}`);
  } else if (totalCount > 0) {
    console.log("   🔴 ① 한글 종목명을 찾지 못했다 → F-SEARCH-01/03 재설계 필요");
    findings.push("🔴 ① /stocks/all 에 한글 종목명 없음 — §7·§8 수정 필요");
  }

  // D-04 판단 근거
  if (totalCount > 0) {
    const gzipEstimate = Math.round((totalCount * 60) / 1024);
    console.log(`   ↳ 전체 종목 수: ${totalCount.toLocaleString()}`);
    console.log(`   ↳ D-04 참고: 종목당 ~60B 로 잡으면 인덱스 약 ${gzipEstimate}KB (gzip 전)`);
    findings.push(`ℹ️  D-04: 전체 ${totalCount.toLocaleString()}종목, 인덱스 추정 ~${gzipEstimate}KB`);
  }

  // ── ② 250봉 소급 조회 (KR) ────────────────────────────────────────
  console.log("\n[3] GET /api/v1/candles — 삼성전자(005930) 250봉 시퀀스 (§8.2)");
  let krSecondOk = false;
  try {
    const first = await call(
      token,
      "/api/v1/candles?symbol=005930&interval=1d&count=200&adjusted=true",
    );
    save("candles-005930-page1", first.body);

    const arr1 = findArray(first.body) ?? [];
    console.log(`   ↳ 1회차: ${arr1.length}봉`);
    console.log(`   ↳ 봉 필드: ${arr1[0] ? Object.keys(arr1[0] as object).join(", ") : "(없음)"}`);
    console.log(`   ↳ 최신 봉: ${JSON.stringify(arr1[0])}`);
    console.log(`   ↳ 최고(古) 봉: ${JSON.stringify(arr1.at(-1))}`);

    // nextBefore 를 응답 어디에서 주는지 확인
    const envelope = first.body as Record<string, unknown>;
    const nextBefore = findNextBefore(envelope);
    console.log(`   ↳ nextBefore: ${nextBefore ?? "(없음)"}`);

    if (nextBefore) {
      // PRD §8.2 주의: 타임존 오프셋 '+' 는 %2B 로 인코딩해야 한다
      const encoded = encodeURIComponent(nextBefore);
      console.log(`   ↳ URL 인코딩: ${encoded}`);

      await sleep(100); // MARKET_DATA_CHART 20 TPS — 여유롭게
      const second = await call(
        token,
        `/api/v1/candles?symbol=005930&interval=1d&count=50&adjusted=true&before=${encoded}`,
      );
      save("candles-005930-page2", second.body);

      const arr2 = findArray(second.body) ?? [];
      console.log(`   ↳ 2회차: ${arr2.length}봉`);
      krSecondOk = arr2.length > 0;

      if (arr1.length + arr2.length >= 250) {
        console.log(`   ✅ ② 250봉 확보 가능 (${arr1.length} + ${arr2.length} = ${arr1.length + arr2.length})`);
        findings.push(`✅ ② 250봉 소급 가능 (${arr1.length}+${arr2.length}봉). §8.2 그대로 성립`);
      } else {
        console.log(`   🔴 ② 250봉 미달: ${arr1.length + arr2.length}봉`);
        findings.push(
          `🔴 ② 250봉 미달 (${arr1.length + arr2.length}봉) — period=250 지원 여부 재검토 필요`,
        );
      }
    } else {
      console.log("   🔴 ② nextBefore 를 찾지 못했다 → 페이지네이션 방식 재확인 필요");
      findings.push("🔴 ② candles 응답에서 nextBefore 를 찾지 못함 — §8.2 재설계 필요");
    }
  } catch (err) {
    fail("③ candles(005930)", err);
  }

  // ── ③ 미국 종목 캔들 타임존 ───────────────────────────────────────
  console.log("\n[4] GET /api/v1/candles — AAPL (③ 미국 종목 타임존 확인)");
  try {
    await sleep(100);
    const us = await call(token, "/api/v1/candles?symbol=AAPL&interval=1d&count=200&adjusted=true");
    save("candles-AAPL-page1", us.body);

    const arr = findArray(us.body) ?? [];
    console.log(`   ↳ ${arr.length}봉`);
    console.log(`   ↳ 최신 봉: ${JSON.stringify(arr[0])}`);

    // 날짜/시각 필드의 형태를 그대로 보여준다. KST 오프셋인지 UTC 인지가 관건이다.
    const dateFields = collectDateLikeFields(arr[0]);
    console.log(`   ↳ 날짜류 필드: ${dateFields.join(", ") || "(없음)"}`);
    findings.push(`ℹ️  ③ AAPL 봉 날짜 필드: ${dateFields.join(", ") || "(없음)"} — 거래일 인덱싱 시 확인`);
  } catch (err) {
    fail("④ candles(AAPL)", err);
  }

  // ── 현재가 다건 조회 ──────────────────────────────────────────────
  console.log("\n[5] GET /api/v1/prices — 다건 조회 (MARKET_DATA, 15 TPS)");
  try {
    const { body } = await call(token, "/api/v1/prices?symbols=005930,000660,AAPL");
    save("prices-multi", body);
    const arr = findArray(body) ?? [];
    console.log(`   ↳ ${arr.length}건 반환`);
    console.log(`   ↳ 필드: ${arr[0] ? Object.keys(arr[0] as object).join(", ") : "(없음)"}`);
    console.log(`   ↳ 샘플: ${JSON.stringify(arr[0])}`);
    findings.push(`✅ /prices 다건 조회 OK (${arr.length}건) — 화면 1·5 의 1회 호출 전제 성립`);
  } catch (err) {
    fail("⑤ /prices", err);
  }

  // ── 매수 유의사항 (F-STATE-02) ────────────────────────────────────
  console.log("\n[6] GET /api/v1/stocks/{symbol}/warnings  (F-STATE-02)");
  try {
    const { body } = await call(token, "/api/v1/stocks/005930/warnings");
    save("warnings-005930", body);
    console.log(`   ↳ ${JSON.stringify(body).slice(0, 400)}`);
    findings.push("✅ /warnings 조회 OK");
  } catch (err) {
    fail("⑥ /warnings", err);
  }

  // ── 장 운영 캘린더 (F-STATE-03) ───────────────────────────────────
  for (const market of ["KR", "US"] as const) {
    console.log(`\n[7] GET /api/v1/market-calendar/${market}  (F-STATE-03)`);
    try {
      const { body } = await call(token, `/api/v1/market-calendar/${market}`);
      save(`market-calendar-${market}`, body);
      console.log(`   ↳ ${JSON.stringify(body).slice(0, 400)}`);
      findings.push(`✅ /market-calendar/${market} 조회 OK`);
    } catch (err) {
      fail(`⑦ /market-calendar/${market}`, err);
    }
  }

  // ── openapi.json 스냅샷 (부록 A) ──────────────────────────────────
  console.log("\n[8] openapi.json 스냅샷 저장 (스펙 변경 감지용)");
  try {
    const res = await fetch(
      "https://openapi.tossinvest.com/openapi-docs/latest/openapi.json",
      { signal: AbortSignal.timeout(30_000) },
    );
    const spec = await res.json();
    mkdirSync(join(process.cwd(), "docs"), { recursive: true });
    writeFileSync(
      join(process.cwd(), "docs", "toss-openapi.snapshot.json"),
      JSON.stringify(spec, null, 2),
      "utf8",
    );
    const pathCount = Object.keys((spec as { paths?: object }).paths ?? {}).length;
    console.log(`   ↳ 저장: docs/toss-openapi.snapshot.json (${pathCount}개 경로)`);
    findings.push(`✅ openapi.json 스냅샷 저장 (${pathCount}개 경로)`);
  } catch (err) {
    fail("⑧ openapi.json 스냅샷", err);
  }

  // ── 요약 ─────────────────────────────────────────────────────────
  console.log(`\n${"═".repeat(70)}`);
  console.log(" 실측 요약");
  console.log("═".repeat(70));
  for (const f of findings) console.log(` ${f}`);

  const blockers = findings.filter((f) => f.startsWith("🔴") || f.startsWith("❌"));
  if (blockers.length > 0) {
    console.log(`\n🔴 게이트 미통과 ${blockers.length}건. PRD §7·§8 수정 여부를 먼저 결정하라.\n`);
    process.exitCode = 1;
  } else {
    console.log("\n✅ 게이트 통과. 1-1 데이터 레이어 구현으로 진행 가능.\n");
  }

  void krSecondOk;
}

/** 응답 envelope 어디에 있든 nextBefore/next 커서를 찾는다 */
function findNextBefore(obj: unknown): string | null {
  if (obj === null || typeof obj !== "object") return null;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (/^(nextBefore|next|before|cursor|nextCursor)$/i.test(k) && typeof v === "string") return v;
    if (v !== null && typeof v === "object") {
      const found = findNextBefore(v);
      if (found !== null) return found;
    }
  }
  return null;
}

/** 봉 객체에서 날짜처럼 생긴 값을 뽑는다 (타임존 확인용) */
function collectDateLikeFields(obj: unknown): string[] {
  if (obj === null || typeof obj !== "object") return [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (typeof v === "string" && /\d{4}-\d{2}-\d{2}|T\d{2}:\d{2}/.test(v)) out.push(`${k}="${v}"`);
    else if (typeof v === "number" && v > 1_000_000_000) out.push(`${k}=${v} (epoch?)`);
  }
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((err: unknown) => {
  console.error("\n예상치 못한 오류:", err);
  process.exit(1);
});
