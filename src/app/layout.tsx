/**
 * 루트 레이아웃 (PRD §5.1 공통 레이아웃 규칙)
 *
 * 기준 폭 375px 모바일 우선, 데스크톱은 최대 480px 중앙 정렬.
 */

import type { Metadata, Viewport } from "next";
import { GoogleAnalytics } from "@next/third-parties/google";

import "./globals.css";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";

/**
 * GA4 측정 ID.
 *
 * 값 자체는 비밀이 아니다(페이지 소스에 그대로 노출되는 값) — 그래서
 * `NEXT_PUBLIC_` 접두사를 붙여도 §11.1 의 토스 자격증명 규칙과 충돌하지
 * 않는다. 다만 로컬 개발 트래픽이 실제 지표에 섞이는 것은 원치 않으므로
 * production 빌드에서만 로드한다.
 */
const GA_MEASUREMENT_ID = "G-BRFJKQE9E4";

export const metadata: Metadata = {
  title: "POSTURE",
  description: "지금 이 종목이 최근 흐름에서 어디쯤인지 보여줍니다.",
  // PWA — 홈 화면 설치.
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    // iOS는 manifest.json 을 안 읽는다 — 별도 태그가 있어야 홈 화면
    // 아이콘이 붙는다.
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // 확대를 막지 않는다 — 접근성 (§15 1-9 Lighthouse 접근성 90+)
  maximumScale: 5,
  // manifest.json 의 theme_color 와 같은 값이다 — 상태 표시줄·설치 시
  // 스플래시 화면 색. §5.1 색상 원칙(위치·구간에 따라 색을 바꾸지 않는다)
  // 과 같은 이유로 앱 전체에서 유일한 중립색 하나만 쓴다.
  themeColor: "#eef0f2",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>
        <div className="app-shell">{children}</div>
      </body>
      {process.env.NODE_ENV === "production" && (
        <>
          <GoogleAnalytics gaId={GA_MEASUREMENT_ID} />
          <ServiceWorkerRegister />
        </>
      )}
    </html>
  );
}
