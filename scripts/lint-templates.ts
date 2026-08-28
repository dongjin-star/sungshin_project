/**
 * 표현 금지어 린트 (PRD §13.2, §7.6 R-05)
 *
 * "R-05는 린트 규칙으로 구현한다. (…) 사람의 주의력에 의존하지 않는다."
 *
 * `npm run build` 의 prebuild 로 걸려 있으므로, 금지어가 들어가면 빌드가 실패한다.
 *
 * ── 왜 문자열 리터럴만 검사하는가 ────────────────────────────────────
 * 주석과 식별자까지 검사하면 PRD를 인용하는 설명 주석이 전부 위반이 된다.
 * ("매수·매도를 권유하지 않는다"라고 적은 주석이 '매수' 때문에 빌드를 깨는 건
 *  규칙의 목적과 정반대다.) 사용자에게 실제로 노출되는 것은 문자열이므로
 * 문자열 리터럴 · 템플릿 리터럴만 대상으로 한다.
 *
 * 예외가 필요하면 같은 줄이나 바로 윗줄에 사유와 함께 표시한다:
 *     limitPosition: "… 미래 가격을 예측하지 않습니다.", // lint-allow: 예측
 */

import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import { relative } from "node:path";

import { FORBIDDEN_WORDS as FORBIDDEN, FORBIDDEN_PHRASES } from "../src/lib/forbidden-words";

interface Finding {
  file: string;
  line: number;
  word: string;
  literal: string;
}

/**
 * TS/TSX 소스에서 문자열 리터럴을 뽑는다.
 * 주석·식별자·정규식은 제외한다.
 *
 * 완전한 파서는 아니지만, 이 목적에는 충분하다 — 놓치는 쪽(false negative)이
 * 아니라 과잉 검출(false positive)만 피하면 되고, 문자열의 시작/끝 판정은
 * 상태 기계로 정확히 할 수 있다.
 */
function extractStringLiterals(source: string): { text: string; line: number }[] {
  const out: { text: string; line: number }[] = [];
  let line = 1;
  let i = 0;

  const n = source.length;
  while (i < n) {
    const ch = source[i]!;
    const next = source[i + 1];

    if (ch === "\n") {
      line += 1;
      i += 1;
      continue;
    }

    // 줄 주석
    if (ch === "/" && next === "/") {
      while (i < n && source[i] !== "\n") i += 1;
      continue;
    }

    // 블록 주석
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < n && !(source[i] === "*" && source[i + 1] === "/")) {
        if (source[i] === "\n") line += 1;
        i += 1;
      }
      i += 2;
      continue;
    }

    // 문자열 / 템플릿 리터럴
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      const startLine = line;
      i += 1;
      let buf = "";
      while (i < n) {
        const c = source[i]!;
        if (c === "\\") {
          buf += source[i + 1] ?? "";
          i += 2;
          continue;
        }
        if (c === quote) {
          i += 1;
          break;
        }
        if (c === "\n") line += 1;
        buf += c;
        i += 1;
      }
      out.push({ text: buf, line: startLine });
      continue;
    }

    i += 1;
  }

  return out;
}

/** 해당 줄 또는 바로 윗줄에 `lint-allow: <word>` 가 있는가 */
function isAllowed(lines: string[], lineNo: number, word: string): boolean {
  const candidates = [lines[lineNo - 1], lines[lineNo - 2]];
  return candidates.some((l) => l !== undefined && l.includes(`lint-allow: ${word}`));
}

function scanFile(path: string): Finding[] {
  const source = readFileSync(path, "utf8");
  const lines = source.split("\n");
  const literals = extractStringLiterals(source);
  const findings: Finding[] = [];

  for (const { text, line } of literals) {
    for (const phrase of FORBIDDEN_PHRASES) {
      if (text.includes(phrase) && !isAllowed(lines, line, phrase)) {
        findings.push({ file: path, line, word: phrase, literal: text });
      }
    }
    for (const word of FORBIDDEN) {
      if (text.includes(word) && !isAllowed(lines, line, word)) {
        findings.push({ file: path, line, word, literal: text });
      }
    }
  }

  return findings;
}

function main(): void {
  // 사용자에게 문구가 노출될 수 있는 모든 소스.
  // forbidden-words.ts 는 이 목록 자체를 정의하는 파일이라 예외다 — 배열
  // 원소가 사용자 화면에 그대로 나가는 게 아니라 AI 응답을 검사하는 데
  // 쓰인다(src/lib/ai/plain-explanation.ts). 자기 자신을 검사하면 정의한
  // 모든 단어가 매번 "위반"으로 잡히는 게 당연하므로 뺀다.
  const files = globSync("src/**/*.{ts,tsx}", { cwd: process.cwd() })
    .map((f) => String(f))
    .filter((f) => !f.includes(".test."))
    .filter((f) => !f.replace(/\\/g, "/").endsWith("src/lib/forbidden-words.ts"));

  const findings = files.flatMap((f) => scanFile(f));

  console.log(`표현 금지어 검사 — ${files.length}개 파일 (PRD §13.2)`);

  if (findings.length === 0) {
    console.log("✅ 위반 없음\n");
    return;
  }

  console.error(`\n❌ 금지 표현 ${findings.length}건 발견 — 빌드를 중단한다.\n`);
  for (const f of findings) {
    const rel = relative(process.cwd(), f.file).replace(/\\/g, "/");
    const preview = f.literal.length > 70 ? `${f.literal.slice(0, 70)}…` : f.literal;
    console.error(`  ${rel}:${f.line}`);
    console.error(`    금지어: "${f.word}"`);
    console.error(`    문자열: "${preview}"\n`);
  }
  console.error(
    "PRD §13.2 의 '허용 (사실 진술)' 목록에 있는 형태로 바꾸라.\n" +
      "거래정지 배지처럼 사실 표시가 명백한 예외라면 같은 줄에 주석을 단다:\n" +
      "    // lint-allow: 위험\n",
  );
  process.exit(1);
}

main();
