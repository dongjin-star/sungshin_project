/**
 * GET /api/quotes?symbols=A,B,C — 검색 결과용 경량 시세 (PRD §5.2, 계약 확장 E-03)
 *
 * 현재가 + 등락률만 준다. 캔들을 새로 받지 않으므로 결과가 몇 건이든
 * 토스 호출은 `/prices` 다건 **1회**다 — §5.2 가 약속한 그대로.
 *
 * 위치·추세가 필요하면 `/api/watchlist` 를 쓴다. 그쪽은 종목당 250봉이
 * 필요하므로 훑어보는 화면에 쓰면 안 된다.
 */

import { NextResponse, type NextRequest } from "next/server";

import { getDb } from "@/lib/db";
import { ensureRuntime } from "@/lib/service/bootstrap";
import { checkRateLimit, clientIp } from "@/lib/api/rate-limit";
import { errorResponse, handleError, isValidSymbolFormat } from "@/lib/api/respond";
import { getQuotes, type Quote } from "@/lib/service/quotes";

export const dynamic = "force-dynamic";

/** 토스 `/prices` 의 1회 상한과 같다 (§8.1). 넘으면 호출이 쪼개진다 */
const MAX_SYMBOLS = 200;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const limit = checkRateLimit(clientIp(request.headers));
  if (!limit.allowed) {
    return errorResponse("BUSY", "요청이 많아 잠시 지연되고 있습니다.", {
      "Retry-After": String(limit.retryAfterSec),
    });
  }

  const symbols = [
    ...new Set(
      (request.nextUrl.searchParams.get("symbols") ?? "")
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter((s) => s.length > 0),
    ),
  ];

  if (symbols.length === 0) {
    return NextResponse.json<{ items: Quote[] }>({ items: [] });
  }

  if (symbols.length > MAX_SYMBOLS || !symbols.every(isValidSymbolFormat)) {
    return errorResponse("INVALID_REQUEST", "잘못된 요청입니다.");
  }

  try {
    ensureRuntime();
    const items = await getQuotes(getDb(), symbols);
    return NextResponse.json<{ items: Quote[] }>(
      { items },
      { headers: { "Cache-Control": "private, max-age=30" } },
    );
  } catch (err) {
    return handleError(err, "GET /api/quotes");
  }
}
