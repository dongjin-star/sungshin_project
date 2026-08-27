/**
 * SQLite 커넥션 — 앱 진입점 (PRD §6.1, D-03 결정: SQLite)
 *
 * 스키마는 §6.1 의 Postgres 정의와 컬럼·PK·인덱스가 동일하다. 캔들 캐시가
 * 커지거나 Phase 2 에서 Supabase 를 붙일 때 Postgres 로 옮기기 쉽게 하기 위해서다.
 *
 * DB 연결 실패는 치명적이지 않다 — 캐시 없이 토스 API 직접 호출로 폴백한다 (§12.4).
 * 성능은 떨어지지만 기능은 유지된다.
 *
 * 구현은 `open.ts` 에 있다. 배치 스크립트가 server-only 를 import 할 수
 * 없기 때문이며, db-init.ts 주석에 적힌 사정과 같다.
 */

import "server-only";

export { openDb as getDb, closeDbInstance as closeDb, dbPath } from "./open";
