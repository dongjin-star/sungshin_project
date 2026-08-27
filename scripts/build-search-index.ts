/**
 * 검색 인덱스 산출물 생성 (PRD D-04)
 *
 * 실행: npm run build:index   (마스터 동기화 뒤에 자동으로도 돌아간다)
 *
 * `public/search-index.json` 을 굽는다. Next 가 `public/` 을 정적으로
 * 서빙하면서 gzip 을 걸어주므로, 클라이언트는 `/search-index.json` 하나만
 * 받으면 된다. 자세한 배경은 `src/lib/service/search-index.ts` 상단 주석 참조.
 */

import { gzipSync, brotliCompressSync, constants } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { closeDbInstance, openDb } from "../src/lib/db/open";
import { SEARCH_INDEX_PATH, buildSearchIndex } from "../src/lib/service/search-index";

try {
  process.loadEnvFile(".env.local");
} catch {
  // CI 등 환경변수가 이미 주입된 경우
}

const kb = (n: number): string => `${(n / 1024).toFixed(0)}KB`;

export function writeSearchIndex(): void {
  const db = openDb();
  if (db === null) {
    console.error("🔴 DB 를 열 수 없다. 검색 인덱스를 만들 수 없다.");
    process.exitCode = 1;
    return;
  }

  const payload = buildSearchIndex(db);

  if (payload.count === 0) {
    // 빈 인덱스를 굽으면 검색이 통째로 죽는다. 기존 파일을 남겨두는 편이 낫다.
    console.error("🔴 상장 종목이 0건이다. 기존 인덱스를 덮어쓰지 않는다. `npm run sync:master` 를 먼저 돌려라.");
    process.exitCode = 1;
    return;
  }

  const json = JSON.stringify(payload);
  mkdirSync(dirname(SEARCH_INDEX_PATH), { recursive: true });
  writeFileSync(SEARCH_INDEX_PATH, json, "utf8");

  const raw = Buffer.byteLength(json);
  // 참고용 측정. 실제 전송 압축은 Next 정적 핸들러가 한다.
  const gz = gzipSync(json, { level: 9 }).length;
  const br = brotliCompressSync(Buffer.from(json), {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
  }).length;

  console.log(
    `검색 인덱스 생성 — ${SEARCH_INDEX_PATH}\n` +
      `  ${payload.count.toLocaleString()}종목 · 원본 ${kb(raw)} · gzip ${kb(gz)} · brotli ${kb(br)}\n` +
      `  기준 시각 ${payload.syncedAt}`,
  );
}

// 다른 스크립트가 import 할 때는 자동 실행하지 않는다
if (process.argv[1]?.includes("build-search-index")) {
  writeSearchIndex();
  closeDbInstance();
}
