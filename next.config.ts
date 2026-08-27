import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // better-sqlite3 is a native module — keep it out of the bundler.
  serverExternalPackages: ["better-sqlite3"],
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: false },

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
