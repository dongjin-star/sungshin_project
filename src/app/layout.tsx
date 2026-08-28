/**
 * 루트 레이아웃 (PRD §5.1 공통 레이아웃 규칙)
 *
 * 기준 폭 375px 모바일 우선, 데스크톱은 최대 480px 중앙 정렬.
 */

import type { Metadata, Viewport } from "next";
import { GoogleAnalytics } from "@next/third-parties/google";
import Script from "next/script";

import "./globals.css";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";
import { THEME_STORAGE_KEY } from "@/lib/theme-key";

/**
 * 다크 모드 FOUC 방지 스크립트 (D-03).
 *
 * React가 뜨기 전, 첫 페인트 전에 실행돼야 한다 — 그래서 `next/script` 의
 * `beforeInteractive` 전략을 쓴다. 저장된 값이 없거나 "system"이면 아무
 * 것도 안 한다: globals.css 의 `prefers-color-scheme` 미디어 쿼리가 이미
 * 첫 페인트부터 적용돼 있어서 손댈 게 없다. "light"/"dark" 를 명시
 * 선택했을 때만 `data-theme` 속성을 미리 박아 둔다.
 */
const THEME_INIT_SCRIPT = `
(function () {
  try {
    var m = localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
    if (m === "dark" || m === "light") {
      document.documentElement.setAttribute("data-theme", m);
    }
  } catch (e) {}
})();
`;

/**
 * GA4 측정 ID.
 *
 * 값 자체는 비밀이 아니다(페이지 소스에 그대로 노출되는 값) — 그래서
 * `NEXT_PUBLIC_` 접두사를 붙여도 §11.1 의 토스 자격증명 규칙과 충돌하지
 * 않는다. 다만 로컬 개발 트래픽이 실제 지표에 섞이는 것은 원치 않으므로
 * production 빌드에서만 로드한다.
 */
const GA_MEASUREMENT_ID = "G-BRFJKQE9E4";

/**
 * 카카오톡 등 링크 미리보기(OG 태그)의 기준 도메인.
 *
 * OG 이미지 URL은 절대경로여야 카톡 크롤러가 제대로 읽는다 —
 * `metadataBase` 없이 상대경로만 주면 Next가 빌드 경고를 내고, 크롤러가
 * 이미지를 못 찾을 수 있다.
 */
const SITE_URL = "https://sungshin-project.vercel.app";

export const metadata: Metadata = {
  title: "POSTURE",
  description: "지금 이 종목이 최근 흐름에서 어디쯤인지 보여줍니다.",
  metadataBase: new URL(SITE_URL),
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
  // 카카오톡 링크 공유 미리보기 (D-08, 2026-08-28). 사이트 <title>은
  // "POSTURE"로 그대로 두고(내부/PRD 코드네임), 공개 공유 카드에만
  // manifest.json 과 같은 공개용 이름 "무사어팔"을 쓴다.
  openGraph: {
    title: "무사어팔",
    description: "지금 이 종목이 최근 흐름에서 어디쯤인지 보여줍니다.",
    siteName: "무사어팔",
    url: SITE_URL,
    type: "website",
    locale: "ko_KR",
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "무사어팔" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // 확대를 막지 않는다 — 접근성 (§15 1-9 Lighthouse 접근성 90+)
  maximumScale: 5,
  // manifest.json 의 theme_color(라이트 기준)와 맞춘 기본값이되, 시스템이
  // 다크를 선호하면 상태 표시줄 색도 같이 어두워진다. §5.1 색상 원칙
  // (위치·구간에 따라 색을 바꾸지 않는다)과는 별개다 — 이건 명암 모드
  // 전환이지 종목별 의미색이 아니다. 사용자가 토글로 명시 선택한 값까지
  // 주소창 색에 실시간 반영하지는 않는다 — data-theme 속성과 별도로
  // meta 태그 쌍을 두 개 다시 조작해야 해서 얻는 것에 비해 복잡도가 크다.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#eef0f2" },
    { media: "(prefers-color-scheme: dark)", color: "#121316" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <head>
        <Script id="theme-init" strategy="beforeInteractive">
          {THEME_INIT_SCRIPT}
        </Script>
      </head>
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
