/**
 * 토스증권 Open API 클라이언트 — 구현부 (PRD §8, §11)
 *
 * ⚠️ **이 모듈을 클라이언트 컴포넌트에서 import 하지 마라.**
 *
 *    앱 코드는 반드시 `lib/toss/client.ts` 를 통해 접근한다. 그쪽이
 *    `import "server-only"` 로 빌드 타임에 클라이언트 유입을 막는다 (§11.2).
 *
 *    구현을 여기로 분리한 이유는 하나뿐이다: `server-only` 는 Node 에서
 *    실제로 throw 하므로, 그 선언이 붙은 모듈은 `scripts/` 의 배치가
 *    import 할 수 없다 (db-init.ts 주석에 같은 사정이 적혀 있다).
 *    마스터 동기화 배치는 이 모듈을 직접 쓴다.
 *
 * 🔒 자격증명과 access_token 은 이 파일 밖으로 나가지 않는다. 로그·에러
 *    메시지·응답 본문 어디에도 값 자체를 싣지 않는다 (§11.1).
 */

import {
  TOSS_TIMEOUT_MS,
  TossApiError,
  mapTossError,
  type TossErrorEnvelope,
} from "./errors";
import { withRateLimit, type RateLimitGroup } from "./rate-limit";

const DEFAULT_BASE = "https://openapi.tossinvest.com";

/** 토스 응답 envelope. 모든 200 응답이 `result` 로 감싸여 온다 (실측 확인) */
interface TossEnvelope<T> {
  result: T;
}

// ── 자격증명 ────────────────────────────────────────────────────────

function credentials(): { clientId: string; clientSecret: string; base: string } {
  const clientId = process.env.TOSS_CLIENT_ID;
  const clientSecret = process.env.TOSS_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    // 값이 아니라 '없다'는 사실만 남긴다
    throw new TossApiError({
      clientCode: "CONFIG_ERROR",
      userMessage: "일시적인 오류가 발생했습니다.",
      httpStatus: 500,
      alertImmediately: true,
      logMessage:
        "🔴 TOSS_CLIENT_ID / TOSS_CLIENT_SECRET 이 주입되지 않았다. " +
        "배포 환경의 시크릿 설정을 확인하라 (§11.1).",
    });
  }

  return {
    clientId,
    clientSecret,
    base: process.env.TOSS_API_BASE ?? DEFAULT_BASE,
  };
}

// ── 토큰 캐싱 ───────────────────────────────────────────────────────

/**
 * 토큰 저장소. 기본 구현은 인프로세스 메모리다.
 *
 * DB 를 쓰는 앱 런타임은 `setTokenStore` 로 `toss_token` 테이블 기반
 * 구현을 주입한다. 스크립트는 한 번 실행되고 끝나므로 메모리로 충분하다.
 */
export interface TokenStore {
  read(): { accessToken: string; expiresAt: number } | null;
  write(token: { accessToken: string; expiresAt: number }): void;
}

let memoryToken: { accessToken: string; expiresAt: number } | null = null;

let tokenStore: TokenStore = {
  read: () => memoryToken,
  write: (t) => {
    memoryToken = t;
  },
};

export function setTokenStore(store: TokenStore): void {
  tokenStore = store;
}

/**
 * 만료 여유. 실측 `expires_in` 은 86399초(≈24시간)다.
 * 발급 직후 만료되는 경계에서 401 을 맞지 않도록 5분 일찍 갱신한다.
 */
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1_000;

/** 동시 요청이 몰려도 토큰 발급은 1회만 나가게 한다 */
let inFlightToken: Promise<string> | null = null;

export async function getAccessToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh) {
    const cached = tokenStore.read();
    if (cached !== null && cached.expiresAt - TOKEN_REFRESH_MARGIN_MS > Date.now()) {
      return cached.accessToken;
    }
  }

  if (inFlightToken !== null && !forceRefresh) return inFlightToken;

  inFlightToken = issueToken().finally(() => {
    inFlightToken = null;
  });

  return inFlightToken;
}

async function issueToken(): Promise<string> {
  const { clientId, clientSecret, base } = credentials();

  return withRateLimit("AUTH", async () => {
    const res = await fetch(`${base}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
      }),
      signal: AbortSignal.timeout(TOSS_TIMEOUT_MS),
    });

    const text = await res.text();

    if (!res.ok) {
      // 🔒 본문에 자격증명이 되비칠 수 있으므로 원문을 로그에 싣지 않는다
      throw mapTossError(res.status, safeParse(text));
    }

    const json = JSON.parse(text) as { access_token?: string; expires_in?: number };
    if (typeof json.access_token !== "string") {
      throw new TossApiError({
        clientCode: "UPSTREAM_ERROR",
        userMessage: "시세 정보를 불러오지 못했습니다.",
        httpStatus: 502,
        logMessage: "토스 토큰 응답에 access_token 이 없다",
      });
    }

    const expiresInSec = json.expires_in ?? 3_600;
    tokenStore.write({
      accessToken: json.access_token,
      expiresAt: Date.now() + expiresInSec * 1_000,
    });

    return json.access_token;
  });
}

// ── 요청 ────────────────────────────────────────────────────────────

function safeParse(text: string): TossErrorEnvelope | null {
  try {
    return JSON.parse(text) as TossErrorEnvelope;
  } catch {
    return null;
  }
}

/**
 * 토스 GET 호출. 그룹별 TPS 를 지키고, 401 이면 토큰을 재발급해 1회 재시도한다.
 *
 * 429 재시도는 `withRateLimit` 이 `Retry-After` 를 보고 처리한다.
 */
export async function tossGet<T>(path: string, group: RateLimitGroup): Promise<T> {
  return withRateLimit(
    group,
    async () => {
      let token = await getAccessToken();
      let res = await rawGet(path, token);

      // 401 — 서버가 토큰을 무효화했을 수 있다. 강제 재발급 후 딱 한 번 더.
      if (res.status === 401) {
        token = await getAccessToken(true);
        res = await rawGet(path, token);
      }

      const text = await res.text();

      if (!res.ok) {
        throw mapTossErrorWithRetryAfter(res, safeParse(text));
      }

      const envelope = JSON.parse(text) as TossEnvelope<T>;
      return envelope.result;
    },
    // 429 만 재시도한다. 403(IP 미등록)·404 는 재시도해도 결과가 같다.
    (err) => {
      if (err instanceof TossApiError && err.httpStatus === 429) {
        return { retryAfterMs: retryAfterMsOf(err) };
      }
      return null;
    },
  );
}

async function rawGet(path: string, token: string): Promise<Response> {
  const { base } = credentials();

  try {
    return await fetch(`${base}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(TOSS_TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new TossApiError({
        clientCode: "TIMEOUT",
        userMessage: "응답이 지연되고 있습니다.",
        httpStatus: 504,
        logMessage: `토스 API 타임아웃 (${TOSS_TIMEOUT_MS}ms): ${path}`,
      });
    }
    throw new TossApiError({
      clientCode: "UPSTREAM_ERROR",
      userMessage: "시세 정보를 불러오지 못했습니다.",
      httpStatus: 502,
      logMessage: `토스 API 네트워크 오류: ${path} — ${
        err instanceof Error ? err.message : String(err)
      }`,
    });
  }
}

/** `Retry-After` 를 에러에 실어 보낸다. 백오프가 이 값을 우선한다 (§8.4) */
const retryAfterMap = new WeakMap<TossApiError, number>();

function mapTossErrorWithRetryAfter(
  res: Response,
  envelope: TossErrorEnvelope | null,
): TossApiError {
  const err = mapTossError(res.status, envelope);
  const header = res.headers.get("retry-after");
  if (header !== null) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) retryAfterMap.set(err, seconds * 1_000);
  }
  return err;
}

function retryAfterMsOf(err: TossApiError): number | null {
  return retryAfterMap.get(err) ?? null;
}
