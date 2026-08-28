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

/**
 * 브라우저가 실제로 내려받는 디렉터리들. `.next/server/app` 은 여기 없다 —
 * App Router의 route.js/page.js는 Node 런타임에서 서버가 실행하는
 * 산출물이지, 브라우저가 그 파일 자체를 요청해 받는 게 아니다(브라우저가
 * 받는 건 `.next/static/chunks`의 클라이언트 번들과 RSC 페이로드뿐이다).
 * 그래서 그 안에 `process.env.GEMINI_API_KEY` 같은 참조가 리터럴로
 * 남아 있는 건 정상이다 — 서버 전용 코드가 자기 몫의 환경변수를 읽었을
 * 뿐이다.
 */
const CLIENT_ONLY_DIRS = [".next/static", "public"];

/**
 * 값(시크릿 그 자체) 검사는 서버 산출물까지 포함해 전부 훑는다. 변수
 * "이름"과 달리 실제 값은 어디에도, 로그에조차 남으면 안 되는 진짜
 * 최후 방어선이다 — `.next/server/app` 에 나타난다면 그건 "서버 코드가
 * 정상적으로 자기 환경변수를 읽었다"가 아니라 "값이 어딘가에 하드코딩
 * 되거나 직렬화됐다"는 신호다.
 */
const ALL_DIRS = [...CLIENT_ONLY_DIRS, ".next/server/app"];

interface Rule {
  label: string;
  scope: "client-only" | "all";
  test: (content: string) => boolean;
}

function buildRules(): Rule[] {
  const rules: Rule[] = [
    // 변수명 자체가 클라이언트 번들에 남는다는 건 클라이언트 코드가 그걸
    // 참조했다는 뜻이다 — 서버 전용 라우트 코드가 자기 환경변수를 읽는
    // 것과는 다른 문제이므로 client-only 로만 본다.
    {
      label: "환경변수명 'TOSS_CLIENT' 문자열",
      scope: "client-only",
      test: (c) => c.includes("TOSS_CLIENT"),
    },
    {
      label: "금지된 NEXT_PUBLIC_TOSS_* 접두사",
      scope: "client-only",
      test: (c) => /NEXT_PUBLIC_TOSS/.test(c),
    },
    // D-04 — Gemini 키도 같은 이유로 검사한다 (src/lib/ai/plain-explanation.ts)
    {
      label: "환경변수명 'GEMINI_API_KEY' 문자열",
      scope: "client-only",
      test: (c) => c.includes("GEMINI_API_KEY"),
    },
    {
      label: "금지된 NEXT_PUBLIC_GEMINI_* 접두사",
      scope: "client-only",
      test: (c) => /NEXT_PUBLIC_GEMINI/.test(c),
    },
  ];

  // 실제 시크릿 값. 로컬에 .env.local 이 있을 때만 검사할 수 있다.
  const secret = process.env.TOSS_CLIENT_SECRET;
  const clientId = process.env.TOSS_CLIENT_ID;
  const geminiKey = process.env.GEMINI_API_KEY;

  // 너무 짧은 값은 우연히 일치할 수 있으므로 제외한다
  if (secret !== undefined && secret.length >= 8) {
    rules.push({ label: "TOSS_CLIENT_SECRET 값", scope: "all", test: (c) => c.includes(secret) });
  }
  if (clientId !== undefined && clientId.length >= 8) {
    rules.push({ label: "TOSS_CLIENT_ID 값", scope: "all", test: (c) => c.includes(clientId) });
  }
  if (geminiKey !== undefined && geminiKey.length >= 8) {
    rules.push({ label: "GEMINI_API_KEY 값", scope: "all", test: (c) => c.includes(geminiKey) });
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
  const scannedFiles = new Set<string>();

  // 텍스트 산출물만 본다. 이미지·폰트는 대상이 아니다.
  const TEXT_EXT = /\.(js|mjs|cjs|json|html|css|map|txt|webmanifest)$/;

  // "all" 스코프 규칙만 서버 산출물까지 보므로, 두 디렉터리 집합을 따로
  // 순회한다 — client-only 규칙이 서버 파일에 걸려 오탐이 나는 걸 막는다.
  for (const dir of ALL_DIRS) {
    const dirIsClientOnly = CLIENT_ONLY_DIRS.includes(dir);
    // client-only 디렉터리에서는 두 스코프 규칙을 다 적용하고, 서버
    // 산출물 디렉터리에서는 "all" 스코프(값 검사)만 적용한다.
    const applicable = rules.filter((r) => r.scope === "all" || dirIsClientOnly);
    for (const file of walk(dir)) {
      if (!TEXT_EXT.test(file)) continue;
      scannedFiles.add(file);
      const content = readFileSync(file, "utf8");
      for (const rule of applicable) {
        if (rule.test(content)) {
          violations.push({ file: relative(process.cwd(), file), rule: rule.label });
        }
      }
    }
  }

  const scanned = scannedFiles.size;

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
