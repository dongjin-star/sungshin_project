/**
 * 토스 API 에러 → 클라이언트 노출 에러 매핑 (PRD §11.3)
 *
 * 핵심 규칙: **토스 API 에러 원문을 클라이언트에 그대로 전달하지 않는다** (§11.1).
 * 원문에는 내부 구조·요청 ID·때로는 인프라 정보가 담긴다.
 *
 * 특히 `CONFIG_ERROR`(403, 허용 IP 미등록)는 사용자에게 원인을 알리지 않되
 * **서버 로그에는 명확히 남긴다.** 배포 직후 가장 흔한 장애 원인이며
 * 빠르게 식별되어야 한다 (§11.3, §12.4).
 */

import type { ClientErrorCode } from "../types";

/** 토스 에러 응답 envelope (공식 문서 기준) */
export interface TossErrorEnvelope {
  error?: {
    requestId?: string;
    code?: string;
    message?: string;
    data?: unknown;
  };
}

export class TossApiError extends Error {
  readonly clientCode: ClientErrorCode;
  /** 사용자에게 보여줄 문구. 원인을 노출하지 않는다 */
  readonly userMessage: string;
  readonly httpStatus: number;
  /** 토스가 준 원본 코드. 로그·Sentry 전용 */
  readonly upstreamCode: string | undefined;
  readonly requestId: string | undefined;
  /** true 면 Sentry 즉시 알림 대상 (배포 사고 가능성) */
  readonly alertImmediately: boolean;

  constructor(params: {
    clientCode: ClientErrorCode;
    userMessage: string;
    httpStatus: number;
    upstreamCode?: string | undefined;
    requestId?: string | undefined;
    alertImmediately?: boolean;
    logMessage: string;
  }) {
    super(params.logMessage);
    this.name = "TossApiError";
    this.clientCode = params.clientCode;
    this.userMessage = params.userMessage;
    this.httpStatus = params.httpStatus;
    this.upstreamCode = params.upstreamCode;
    this.requestId = params.requestId;
    this.alertImmediately = params.alertImmediately ?? false;
  }
}

/** §11.3 매핑 테이블. 사용자 표시 문구는 이 표 밖으로 나갈 수 없다 */
export function mapTossError(
  httpStatus: number,
  envelope: TossErrorEnvelope | null,
): TossApiError {
  const upstreamCode = envelope?.error?.code;
  const requestId = envelope?.error?.requestId;
  const upstreamMessage = envelope?.error?.message ?? "(메시지 없음)";

  const base = {
    httpStatus,
    upstreamCode,
    requestId,
  };

  // 401 — 토큰 만료/무효. 호출부가 재발급 후 1회 재시도하며, 여기까지 왔다면
  //       재시도도 실패한 것이다.
  if (httpStatus === 401) {
    return new TossApiError({
      ...base,
      clientCode: "UPSTREAM_ERROR",
      userMessage: "시세 정보를 불러오지 못했습니다.",
      logMessage: `토스 401 (재발급 후에도 실패): ${upstreamCode} ${upstreamMessage}`,
    });
  }

  // 403 — 대개 허용 IP 미등록. 🔴 사용자에게 원인을 노출하지 않는다.
  if (httpStatus === 403) {
    return new TossApiError({
      ...base,
      clientCode: "CONFIG_ERROR",
      userMessage: "일시적인 오류가 발생했습니다.",
      alertImmediately: true,
      logMessage:
        `🔴 토스 403 (${upstreamCode ?? "edge-blocked"}) — ` +
        "허용 IP 미등록 가능성이 높다. 토스 WTS > 설정 > Open API > IP 관리에서 " +
        "이 서버의 아웃바운드 IP가 등록되어 있는지 즉시 확인하라. " +
        `upstream: ${upstreamMessage}`,
    });
  }

  if (httpStatus === 404) {
    return new TossApiError({
      ...base,
      clientCode: "NOT_FOUND",
      userMessage: "해당 종목을 찾을 수 없습니다.",
      logMessage: `토스 404: ${upstreamCode} ${upstreamMessage}`,
    });
  }

  if (httpStatus === 429) {
    return new TossApiError({
      ...base,
      clientCode: "BUSY",
      userMessage: "요청이 많아 잠시 지연되고 있습니다.",
      logMessage: `토스 429 rate limit: ${upstreamCode} ${upstreamMessage}`,
    });
  }

  return new TossApiError({
    ...base,
    clientCode: "UPSTREAM_ERROR",
    userMessage: "시세 정보를 불러오지 못했습니다.",
    logMessage: `토스 ${httpStatus}: ${upstreamCode} ${upstreamMessage}`,
  });
}

/** 타임아웃 (§11.3 — 8초) */
export function timeoutError(path: string): TossApiError {
  return new TossApiError({
    clientCode: "TIMEOUT",
    userMessage: "응답이 지연되고 있습니다.",
    httpStatus: 504,
    logMessage: `토스 API 타임아웃 (${TOSS_TIMEOUT_MS}ms): ${path}`,
  });
}

/** PRD §11.3 — 타임아웃 8초 */
export const TOSS_TIMEOUT_MS = 8_000;

/**
 * 로그 한 줄.
 *
 * 즉시 대응이 필요한 오류(`alertImmediately`)는 로그에서 눈에 띄어야 한다.
 * 그 표시를 **여기 한 곳에서만** 붙인다 — 호출부마다 각자 붙이면 이미 표시가
 * 들어 있는 메시지에 하나 더 붙어 "🔴 🔴" 가 된다.
 */
export function logLine(err: TossApiError): string {
  const marked = err.alertImmediately && !err.message.startsWith("🔴");
  return marked ? `🔴 ${err.message}` : err.message;
}

/**
 * 로깅용 안전 요약.
 * 토큰·시크릿은 절대 담기지 않는다. 유효성은 불리언으로만 남긴다 (§11.1).
 */
export function toLogFields(err: TossApiError): Record<string, unknown> {
  return {
    clientCode: err.clientCode,
    httpStatus: err.httpStatus,
    upstreamCode: err.upstreamCode ?? null,
    requestId: err.requestId ?? null,
    alertImmediately: err.alertImmediately,
  };
}
