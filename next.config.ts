import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // better-sqlite3 is a native module — keep it out of the bundler.
  serverExternalPackages: ["better-sqlite3"],
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: false },

  // Next's file tracing only follows static `import`/`require` calls. Both
  // of these are read at runtime via `fs.readFileSync`/`better-sqlite3`
  // with a computed path (`src/lib/db/open.ts`), so tracing never sees
  // them and Vercel would ship a function bundle without them — every
  // `openDb()` call would then throw ENOENT (§10.3-a).
  outputFileTracingIncludes: {
    "/**": ["src/lib/db/schema.sql", "assets/stock-master.sqlite3"],
  },

  async headers() {
    return [
      {
        // 검색 인덱스 (D-04). 마스터 배치가 일 1회이므로 하루 붙잡아도 된다.
        // Next 의 정적 핸들러가 기본으로 max-age=0 을 주기 때문에 명시한다 —
        // 그대로 두면 매 진입마다 346KB 재검증 요청이 나간다.
        source: "/search-index.json",
        headers: [
          { key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" },
        ],
      },
    ];
  },
};

export default nextConfig;
