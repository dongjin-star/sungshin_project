/**
 * GET /api/stock/{symbol}?period=120 — 종목 상세 (PRD §6.4)
 *
 * 응답에 세 기간(60/120/250)이 전부 담긴다 — 계약 확장 E-01.
 * 기간 토글이 네트워크 0회가 되는 근거이고, §14.2 의 "기간 토글 반영
 * 100ms 이내" 목표가 이 방식이라야 달성된다.
 *
 * 캐시가 차 있으면 토스 호출은 1회(prices)다 (§10.4).
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
import { analyzeStock, stockContext } from "@/lib/service/stock";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ symbol: string }> },
): Promise<NextResponse> {
  const limit = checkRateLimit(clientIp(request.headers));
  if (!limit.allowed) {
    return errorResponse("BUSY", "요청이 많아 잠시 지연되고 있습니다.", {
      "Retry-After": String(limit.retryAfterSec),
    });
  }

  const { symbol: raw } = await params;
  const symbol = raw.toUpperCase();

  if (!isValidSymbolFormat(symbol)) {
    return errorResponse("INVALID_REQUEST", "잘못된 요청입니다.");
  }

  const period = parsePeriod(request.nextUrl.searchParams.get("period"));
  if (period === null) {
    return errorResponse("INVALID_REQUEST", "잘못된 요청입니다.");
  }

  try {
    ensureRuntime();
    const db = getDb();

    // §11.4 심볼 검증 — 마스터에 없는 심볼은 토스로 넘기지 않는다.
    // 임의 문자열이 그대로 상류로 흘러가는 경로를 여기서 끊는다.
    const ctx = stockContext(db, symbol);
    if (ctx === null) {
      return errorResponse("NOT_FOUND", "해당 종목을 찾을 수 없습니다.");
    }

    const result = await analyzeStock(db, symbol, ctx, period);

    return NextResponse.json(result, {
      headers: {
        // 현재가가 30초 캐시이므로 그 이상 붙잡아 둘 이유가 없다 (§10.4)
        "Cache-Control": "private, max-age=30",
      },
    });
  } catch (err) {
    return handleError(err, `GET /api/stock/${symbol}`);
  }
}
