import path from "node:path";

import { defineConfig } from "vitest/config";

/**
 * 테스트 대부분은 순수 계산이라 node 환경이면 충분하고, 그쪽이 훨씬 빠르다.
 * DOM 이 필요한 것은 `*.dom.test.ts(x)` 로 이름을 붙여 그 파일만 happy-dom
 * 으로 돌린다.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "node",
    environmentMatchGlobs: [["tests/**/*.dom.test.{ts,tsx}", "happy-dom"]],
  },
});
