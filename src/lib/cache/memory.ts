/**
 * 인메모리 TTL 캐시 (PRD §10.4)
 *
 * 현재가 30초 · 유의사항 30분 · 캘린더 24시간. 전부 재생성 가능한 값이라
 * 프로세스가 죽으면 같이 사라져도 된다. 영속이 필요한 것(캔들·마스터·토큰)은
 * SQLite 로 간다.
 *
 * ⚠️ 인프로세스다. `rate-limit.ts` 의 토큰 버킷과 같은 전제 위에 있다 —
 *    단일 인스턴스 배포(§10.3). 다중 인스턴스로 가면 Redis 로 바꿔야 한다.
 */

interface Entry<T> {
  value: T;
  expiresAt: number;
}

export class TtlCache<T> {
  private readonly store = new Map<string, Entry<T>>();

  constructor(
    private readonly ttlMs: number,
    /** 상한. 넘으면 가장 오래된 것부터 버린다 (Map 은 삽입 순서를 지킨다) */
    private readonly maxEntries = 5_000,
  ) {}

  get(key: string): T | undefined {
    const hit = this.store.get(key);
    if (hit === undefined) return undefined;

    if (hit.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }

    return hit.value;
  }

  set(key: string, value: T, ttlMs = this.ttlMs): void {
    if (this.store.size >= this.maxEntries) {
      const oldest = this.store.keys().next();
      if (!oldest.done) this.store.delete(oldest.value);
    }
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  /**
   * 캐시 미스면 `load` 를 부른다.
   *
   * 같은 키에 동시 요청이 몰리면 **로드는 1회만** 나간다. 이게 없으면
   * 캐시가 비는 순간 같은 종목에 대한 토스 호출이 동시 요청 수만큼 터진다.
   */
  private readonly inFlight = new Map<string, Promise<T>>();

  async getOrLoad(key: string, load: () => Promise<T>, ttlMs = this.ttlMs): Promise<T> {
    const hit = this.get(key);
    if (hit !== undefined) return hit;

    const pending = this.inFlight.get(key);
    if (pending !== undefined) return pending;

    const promise = load()
      .then((value) => {
        this.set(key, value, ttlMs);
        return value;
      })
      .finally(() => {
        this.inFlight.delete(key);
      });

    this.inFlight.set(key, promise);
    return promise;
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
    this.inFlight.clear();
  }

  get size(): number {
    return this.store.size;
  }
}

/** §10.4 의 TTL 들 */
export const TTL = {
  PRICE_MS: 30 * 1_000,
  WARNINGS_MS: 30 * 60 * 1_000,
  CALENDAR_MS: 24 * 60 * 60 * 1_000,
  /** 검색 인덱스는 마스터 배치(일 1회)와 같은 주기다 */
  SEARCH_INDEX_MS: 60 * 60 * 1_000,
} as const;
