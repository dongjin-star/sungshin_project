/**
 * 우리 API 보호 — IP 기준 rate limiting (PRD §11.4)
 *
 * Phase 1 은 인증이 없다. 우리 엔드포인트가 무단 시세 프록시로 쓰이는 것을
 * 막는 장치가 필요하다. §11.4 가 지정한 값은 **IP당 60 req/min** 이다.
 *
 * 슬라이딩 윈도우가 아니라 고정 윈도우다. 경계에서 최대 2배가 통과할 수
 * 있지만, 목적이 남용 차단이지 정밀 과금이 아니므로 이걸로 충분하다.
 *
 * ⚠️ 인프로세스. 단일 인스턴스 배포 전제(§10.3)는 토큰 버킷·메모리 캐시와 같다.
 */

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 60;

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();

/** 윈도우가 끝난 항목이 무한히 쌓이지 않게 가끔 청소한다 */
let lastSweep = Date.now();

function sweep(now: number): void {
  if (now - lastSweep < WINDOW_MS) return;
  for (const [key, w] of windows) {
    if (w.resetAt <= now) windows.delete(key);
  }
  lastSweep = now;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** 초 단위. 429 응답의 `Retry-After` 로 그대로 나간다 */
  retryAfterSec: number;
}

export function checkRateLimit(key: string, now = Date.now()): RateLimitResult {
  sweep(now);

  const existing = windows.get(key);

  if (existing === undefined || existing.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, remaining: MAX_REQUESTS - 1, retryAfterSec: 0 };
  }

  existing.count += 1;

  if (existing.count > MAX_REQUESTS) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - now) / 1_000)),
    };
  }

  return {
    allowed: true,
    remaining: MAX_REQUESTS - existing.count,
    retryAfterSec: 0,
  };
}

/**
 * 요청자 IP.
 *
 * Fly.io 는 `fly-client-ip` 를 붙인다. 프록시 뒤에 있으므로 소켓 주소는
 * 쓸 수 없다. 헤더가 하나도 없으면 전부 같은 키로 묶인다 — 로컬 개발에서만
 * 일어나는 상황이고, 그때는 제한이 걸려도 문제되지 않는다.
 */
export function clientIp(headers: Headers): string {
  return (
    headers.get("fly-client-ip") ??
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headers.get("x-real-ip") ??
    "unknown"
  );
}

/** 테스트용 */
export function __resetRateLimits(): void {
  windows.clear();
}

export const RATE_LIMIT = { WINDOW_MS, MAX_REQUESTS } as const;
