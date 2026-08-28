/**
 * GET /api/stock/{symbol}/explain?period=120 — "쉬운 설명" 탭 AI 부연 설명 (D-04)
 *
 * `/api/stock/{symbol}` 이 이미 계산해 둔 위치·흐름 사실을 그대로 다시
 * 계산해(대부분 캐시 히트) Gemini에게 근거로 넘긴다. 클라이언트가 보낸
 * 숫자를 신뢰하지 않는다 — `src/lib/ai/plain-explanation.ts` 상단 주석
 * 참조. 그래서 이 라우트는 `symbol`과 `period`만 받는다.
 *
 * 사용자가 "쉬운 설명" 탭에서 "AI 설명 더 보기"를 눌렀을 때만 호출된다
 * (자동 프리페치 아님) — Gemini 호출 비용을 사용자 의도가 있을 때로 제한한다.
 */

import { NextResponse, type NextRequest } from "next/server";

import { getDb } from "@/lib/db";
import { ensureRuntime } from "@/lib/service/bootstrap";
import { checkRateLimit, clientIp } from "@/lib/api/rate-limit";
import { errorResponse, handleError, isValidSymbolFormat, parsePeriod } from "@/lib/api/respond";
import { analyzeStock, stockContext } from "@/lib/service/stock";
import { generatePlainExplanation, PlainExplanationError } from "@/lib/ai/plain-explanation";
import type { PlainExplanationResponse } from "@/lib/types";

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

    const ctx = stockContext(db, symbol);
    if (ctx === null) {
      return errorResponse("NOT_FOUND", "해당 종목을 찾을 수 없습니다.");
    }

    const analysis = await analyzeStock(db, symbol, ctx, period);

    // §12.1 — 거래정지 등으로 계산 자체가 막힌 경우 AI에게 넘길 사실이 없다
    const blocking = analysis.warnings.find((w) => w.blocksAnalysis) ?? null;
    const position = blocking === null && analysis.positions[period].available
      ? analysis.positions[period]
      : null;
    const trend = blocking === null && analysis.trend[period].available
      ? analysis.trend[period]
      : null;

    if (position === null && trend === null) {
      return errorResponse("INVALID_REQUEST", "설명할 위치·흐름 정보가 없습니다.");
    }

    const result = await generatePlainExplanation({
      name: analysis.name,
      market: analysis.market,
      currency: analysis.currency,
      periodDays: period,
      price: analysis.price,
      position,
      trend,
    });

    const response: PlainExplanationResponse = result;

    return NextResponse.json(response, {
      headers: { "Cache-Control": "private, max-age=60" },
    });
  } catch (err) {
    if (err instanceof PlainExplanationError) {
      const code = err.message.includes("GEMINI_API_KEY") ? "CONFIG_ERROR" : "UPSTREAM_ERROR";
      return errorResponse(code, err.message);
    }
    return handleError(err, `GET /api/stock/${symbol}/explain`);
  }
}
