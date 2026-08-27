/**
 * GET /api/watchlist?symbols=A,B,C&period=120 — 관심종목 일괄 (PRD §6.4)
 *
 * 현재가는 **1회 다건 호출**로 끝난다 (§8.1 F-WATCH-02). 1-6 의 검증
 * 기준인 "20종목 조회 시 토스 호출 1회"가 이 경로다.
 *
 * 한 종목이 실패해도 그 행에만 `error` 를 달고 나머지는 정상 반환한다 (§12.4).
 */

import { NextResponse, type NextRequest } from "next/server";

import { getDb } from "@/lib/db";
import { ensureRuntime } from "@/lib/service/bootstrap";
import { checkRateLimit, clientIp } from "@/lib/api/rate-limit";
import {
  errorResponse,
  handleError,
  isValidSymbolFormat,
  parsePeriod,
} from "@/lib/api/respond";
import { analyzeWatchlist } from "@/lib/service/stock";
import type { WatchlistResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * 한 번에 볼 수 있는 관심종목 수.
 *
 * 토스 `/prices` 의 1회 상한이 200종목이고(§8.1), 그보다 많으면 다건
 * 호출이 쪼개져 "1회 호출" 전제가 깨진다. 화면 5 가 그만큼을 한 번에
 * 보여줄 일도 없다.
 */
const MAX_SYMBOLS = 100;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const limit = checkRateLimit(clientIp(request.headers));
  if (!limit.allowed) {
    return errorResponse("BUSY", "요청이 많아 잠시 지연되고 있습니다.", {
      "Retry-After": String(limit.retryAfterSec),
    });
  }

  const raw = request.nextUrl.searchParams.get("symbols") ?? "";
  const symbols = [
    ...new Set(
      raw
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter((s) => s.length > 0),
    ),
  ];

  if (symbols.length === 0) {
    return NextResponse.json<WatchlistResponse>({ items: [] });
  }

  if (symbols.length > MAX_SYMBOLS || !symbols.every(isValidSymbolFormat)) {
    return errorResponse("INVALID_REQUEST", "잘못된 요청입니다.");
  }

  const period = parsePeriod(request.nextUrl.searchParams.get("period"));
  if (period === null) {
    return errorResponse("INVALID_REQUEST", "잘못된 요청입니다.");
  }

  try {
    ensureRuntime();
    const items = await analyzeWatchlist(getDb(), symbols, period);
    return NextResponse.json<WatchlistResponse>(
      { items },
      { headers: { "Cache-Control": "private, max-age=30" } },
    );
  } catch (err) {
    return handleError(err, "GET /api/watchlist");
  }
}
