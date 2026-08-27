/**
 * 빌드 산출물 시크릿 유출 검사 (PRD §11.2-3)
 *
 * "실수를 사후에 잡는 최후 방어선이다. CI 파이프라인에 포함한다."
 *
 * 1차 방어는 `import "server-only"` (클라이언트에서 import 하면 빌드 실패),
 * 2차는 ESLint 의 NEXT_PUBLIC_TOSS_* 금지 룰이다. 이 스크립트는 3차로,
 * 실제로 브라우저에 내려가는 파일에 시크릿이 섞이지 않았는지 확인한다.
 *
 * `npm run build` 뒤에 자동 실행된다.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

try {
  process.loadEnvFile(".env.local");
} catch {
  // 환경변수가 이미 주입된 CI 환경
}

/** 브라우저로 내려가는 디렉터리들 */
const CLIENT_DIRS = [".next/static", ".next/server/app", "public"];

interface Rule {
  label: string;
  test: (content: string) => boolean;
}

function buildRules(): Rule[] {
  const rules: Rule[] = [
    // 변수명 자체가 번들에 남는다는 건 클라이언트 코드가 그걸 참조했다는 뜻이다
    {
      label: "환경변수명 'TOSS_CLIENT' 문자열",
      test: (c) => c.includes("TOSS_CLIENT"),
    },
    {
      label: "금지된 NEXT_PUBLIC_TOSS_* 접두사",
      test: (c) => /NEXT_PUBLIC_TOSS/.test(c),
    },
  ];

  // 실제 시크릿 값. 로컬에 .env.local 이 있을 때만 검사할 수 있다.
  const secret = process.env.TOSS_CLIENT_SECRET;
  const clientId = process.env.TOSS_CLIENT_ID;

  // 너무 짧은 값은 우연히 일치할 수 있으므로 제외한다
  if (secret !== undefined && secret.length >= 8) {
    rules.push({ label: "TOSS_CLIENT_SECRET 값", test: (c) => c.includes(secret) });
  }
  if (clientId !== undefined && clientId.length >= 8) {
    rules.push({ label: "TOSS_CLIENT_ID 값", test: (c) => c.includes(clientId) });
  }

  return rules;
}

function* walk(dir: string): Generator<string> {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else yield full;
  }
}

function main(): void {
  const rules = buildRules();
  const violations: { file: string; rule: string }[] = [];
  let scanned = 0;

  // 텍스트 산출물만 본다. 이미지·폰트는 대상이 아니다.
  const TEXT_EXT = /\.(js|mjs|cjs|json|html|css|map|txt|webmanifest)$/;

  for (const dir of CLIENT_DIRS) {
    for (const file of walk(dir)) {
      if (!TEXT_EXT.test(file)) continue;
      scanned += 1;
      const content = readFileSync(file, "utf8");
      for (const rule of rules) {
        if (rule.test(content)) {
          violations.push({ file: relative(process.cwd(), file), rule: rule.label });
        }
      }
    }
  }

  console.log(
    `번들 시크릿 검사 — ${scanned}개 파일 / 규칙 ${rules.length}개 (PRD §11.2)`,
  );

  if (scanned === 0) {
    console.log("ℹ️  검사할 빌드 산출물이 없다. `npm run build` 후에 실행되는 검사다.\n");
    return;
  }

  if (violations.length === 0) {
    console.log("✅ 유출 없음\n");
    return;
  }

  console.error(`\n🔴 시크릿 유출 의심 ${violations.length}건 — 배포를 중단한다.\n`);
  for (const v of violations) {
    console.error(`  ${v.file.replace(/\\/g, "/")}`);
    console.error(`    → ${v.rule}\n`);
  }
  console.error(
    "토스 자격증명은 src/lib/toss/client.ts 에서만 읽어야 하며,\n" +
      "해당 모듈은 최상단에 import \"server-only\" 를 선언해야 한다 (PRD §11.1).\n",
  );
  process.exit(1);
}

main();
