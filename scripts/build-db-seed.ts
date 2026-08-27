/**
 * 종목 마스터 스냅샷 산출물 생성 (PRD §10.3-a)
 *
 * 실행: npm run build:db-seed   (마스터 동기화 뒤에 자동으로도 돌아간다)
 *
 * `assets/stock-master.sqlite3` 를 굽는다. Vercel 배포 시 콜드스타트마다
 * 이 파일에서 `stock` 테이블을 복원한다. 자세한 배경은
 * `src/lib/service/db-seed.ts` 상단 주석 참조.
 */

import { closeDbInstance, openDb } from "../src/lib/db/open";
import { countStocks } from "../src/lib/db/repo";
import { DB_SEED_PATH, writeDbSeed } from "../src/lib/service/db-seed";

try {
  process.loadEnvFile(".env.local");
} catch {
  // CI 등 환경변수가 이미 주입된 경우
}

export function buildDbSeed(): void {
  const db = openDb();
  if (db === null) {
    console.error("🔴 DB 를 열 수 없다. 스냅샷을 만들 수 없다.");
    process.exitCode = 1;
    return;
  }

  if (countStocks(db) === 0) {
    // 빈 스냅샷을 구우면 배포 환경이 텅 빈 채로 시작한다. 기존 파일을 남긴다.
    console.error(
      "🔴 종목 마스터가 0건이다. 기존 스냅샷을 덮어쓰지 않는다. `npm run sync:master` 를 먼저 돌려라.",
    );
    process.exitCode = 1;
    return;
  }

  const { count } = writeDbSeed(db);
  console.log(`종목 마스터 스냅샷 생성 — ${DB_SEED_PATH}\n  ${count.toLocaleString()}종목`);
}

// 다른 스크립트가 import 할 때는 자동 실행하지 않는다
if (process.argv[1]?.includes("build-db-seed")) {
  buildDbSeed();
  closeDbInstance();
}
