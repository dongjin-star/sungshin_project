/**
 * 그룹별 토큰 버킷 큐 (PRD §8.4)
 *
 * 토스는 API 그룹마다 다른 TPS 한도를 건다. 캐시 미스가 몰릴 때
 * MARKET_DATA_CHART 20 TPS 를 넘지 않도록 요청을 직렬화하고,
 * 대기 중인 클라이언트에는 스켈레톤을 유지한다.
 *
 * ⚠️ 이 버킷은 **인프로세스**다. 단일 인스턴스 배포를 전제한다.
 *    PRD §10.3 이 Fly.io 단일 앱 + dedicated IPv4 를 채택했고, 애초에
 *    허용 IP 화이트리스트 때문에 인스턴스를 늘리기도 어렵다.
 *    다중 인스턴스로 확장한다면 Redis 등 공유 버킷으로 바꿔야 한다.
 */

/** PRD §8.4 + 토스 공식 문서의 그룹별 한도 (TPS) */
export const RATE_LIMITS = {
  AUTH: 5,
  /** 🔴 1 TPS. 절대 사용자 요청 경로에 두지 않는다 — 일 1회 배치 전용 */
  STOCK_ALL: 1,
  STOCK: 5,
  MARKET_DATA: 15,
  MARKET_DATA_CHART: 20,
  MARKET_INFO: 3,
} as const;

export type RateLimitGroup = keyof typeof RATE_LIMITS;

/** 재시도 정책 (§8.4, §12.4) */
export const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 1_000;

class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  /** 대기 중인 요청. 순서를 보장하려고 배열로 둔다 */
  private readonly queue: (() => void)[] = [];
  private draining = false;

  constructor(private readonly tps: number) {
    this.tokens = tps;
    this.lastRefill = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    if (elapsed <= 0) return;
    this.tokens = Math.min(this.tps, this.tokens + elapsed * this.tps);
    this.lastRefill = now;
  }

  /** 토큰 1개를 얻을 때까지 대기한다 */
  async acquire(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
      void this.drain();
    });
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;

    while (this.queue.length > 0) {
      this.refill();

      if (this.tokens >= 1) {
        this.tokens -= 1;
        this.queue.shift()!();
        continue;
      }

      // 다음 토큰이 채워질 때까지 기다린다
      const waitMs = Math.ceil(((1 - this.tokens) / this.tps) * 1000);
      await sleep(Math.max(waitMs, 5));
    }

    this.draining = false;
  }
}

const buckets = new Map<RateLimitGroup, TokenBucket>();

function bucketFor(group: RateLimitGroup): TokenBucket {
  let b = buckets.get(group);
  if (b === undefined) {
    b = new TokenBucket(RATE_LIMITS[group]);
    buckets.set(group, b);
  }
  return b;
}

/**
 * 해당 그룹의 TPS 한도를 지키며 작업을 실행한다.
 *
 * 429 를 받으면 `Retry-After` 만큼 기다린 뒤 지수 백오프 + jitter 로 재시도한다.
 * jitter 가 없으면 동시에 밀린 요청들이 같은 시각에 재시도해 다시 429 를 맞는다.
 *
 * @param shouldRetry 재시도 여부와 대기 시간을 판단한다. null 이면 재시도 안 함
 */
export async function withRateLimit<T>(
  group: RateLimitGroup,
  task: () => Promise<T>,
  shouldRetry?: (err: unknown) => { retryAfterMs: number | null } | null,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    await bucketFor(group).acquire();

    try {
      return await task();
    } catch (err) {
      lastError = err;
      if (attempt === MAX_RETRIES || shouldRetry === undefined) break;

      const decision = shouldRetry(err);
      if (decision === null) break;

      // Retry-After 헤더가 있으면 그 값을 우선한다. 없으면 1s → 2s → 4s.
      const backoff = decision.retryAfterMs ?? BACKOFF_BASE_MS * 2 ** attempt;
      const jitter = Math.random() * 250;
      await sleep(backoff + jitter);
    }
  }

  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 테스트용 — 버킷 상태를 초기화한다 */
export function __resetBuckets(): void {
  buckets.clear();
}
