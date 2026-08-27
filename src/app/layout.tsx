/**
 * 루트 레이아웃 (PRD §5.1 공통 레이아웃 규칙)
 *
 * 기준 폭 375px 모바일 우선, 데스크톱은 최대 480px 중앙 정렬.
 */

import type { Metadata, Viewport } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "POSTURE",
  description: "지금 이 종목이 최근 흐름에서 어디쯤인지 보여줍니다.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // 확대를 막지 않는다 — 접근성 (§15 1-9 Lighthouse 접근성 90+)
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>
        <div className="app-shell">{children}</div>
      </body>
    </html>
  );
}
