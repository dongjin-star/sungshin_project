/**
 * API 응답 헬퍼 (PRD §11.3, §11.4)
 *
 * 🔒 규칙 하나: **토스 에러 원문은 클라이언트로 나가지 않는다.**
 *    `TossApiError` 가 들고 있는 `userMessage` 만 내보내고, 진단 정보는
 *    서버 로그에만 남긴다 (§11.1).
 */

import { NextResponse } from "next/server";

import { TossApiError, logLine, toLogFields } from "../toss/errors";
import type { ApiErrorResponse, ClientErrorCode } from "../types";

const STATUS_OF: Record<ClientErrorCode, number> = {
  NOT_FOUND: 404,
  BUSY: 429,
  UPSTREAM_ERROR: 502,
  TIMEOUT: 504,
  CONFIG_ERROR: 500,
  INVALID_REQUEST: 400,
};

export function errorResponse(
  code: ClientErrorCode,
  message: string,
  extraHeaders?: Record<string, string>,
): NextResponse<ApiErrorResponse> {
  return NextResponse.json<ApiErrorResponse>(
    { error: { code, message } },
    { status: STATUS_OF[code], headers: extraHeaders },
  );
}

/**
 * 던져진 무엇이든 안전한 응답으로 바꾼다.
 *
 * `alertImmediately` 가 붙은 에러(403 = 허용 IP 미등록)는 배포 직후 가장
 * 흔한 장애이므로 로그에서 눈에 띄게 남긴다 (§11.3, §12.4).
 */
export function handleError(err: unknown, context: string): NextResponse<ApiErrorResponse> {
  if (err instanceof TossApiError) {
    console.error(`[${context}] ${logLine(err)}`, toLogFields(err));
    return errorResponse(err.clientCode, err.userMessage);
  }

  console.error(`[${context}] 처리되지 않은 오류:`, err);
  return errorResponse("UPSTREAM_ERROR", "시세 정보를 불러오지 못했습니다.");
}

/** §6.4 — 심볼 형식. 토스 스펙과 같은 문자 집합만 허용한다 */
const SYMBOL_PATTERN = /^[A-Za-z0-9.\-]{1,20}$/;

export function isValidSymbolFormat(symbol: string): boolean {
  return SYMBOL_PATTERN.test(symbol);
}

/** §4.1 F-POS-04 — 허용된 기간만 통과시킨다 */
export function parsePeriod(raw: string | null): 60 | 120 | 250 | null {
  if (raw === null) return 120;
  const n = Number(raw);
  return n === 60 || n === 120 || n === 250 ? n : null;
}
