/**
 * 런타임 초기화 (PRD §10.4 — 토큰 캐시를 DB 로)
 *
 * 기본 토큰 저장소는 인프로세스 메모리다(core.ts). 앱 런타임은 재배포·재시작이
 * 잦고 그때마다 토큰을 새로 받으면 AUTH(5 TPS)를 낭비한다. `toss_token`
 * 테이블에 얹어 재시작을 넘겨 살아남게 한다.
 *
 * 라우트가 매번 부르지만 실제 작업은 한 번만 일어난다.
 */

import { getDb } from "../db";
import { readToken, writeToken } from "../db/repo";
import { setTokenStore } from "../toss/core";

let initialized = false;

export function ensureRuntime(): void {
  if (initialized) return;

  const db = getDb();
  if (db === null) {
    // DB 없이도 동작해야 한다 (§12.4). 메모리 저장소를 그대로 쓴다.
    initialized = true;
    return;
  }

  setTokenStore({
    read: () => readToken(db),
    write: (token) => writeToken(db, token),
  });

  initialized = true;
}
