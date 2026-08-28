"use client";

/**
 * 서비스 워커 등록 (PWA)
 *
 * 등록 실패가 앱 동작을 막으면 안 된다 — 서비스 워커는 "설치하면 더
 * 좋은" 부가 기능이지 필수 경로가 아니다. 그래서 지원 여부 확인부터
 * 등록까지 전부 try-catch로 감싸고, 실패는 콘솔 경고로만 남긴다.
 *
 * 무엇을 캐싱하는지·안 하는지는 이 파일이 아니라 `public/sw.js` 가
 * 정한다 — 여기는 그 파일을 등록하기만 한다.
 */

import { useEffect } from "react";

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    const register = async (): Promise<void> => {
      try {
        await navigator.serviceWorker.register("/sw.js");
      } catch (err) {
        // 오프라인 지원이 빠질 뿐, 앱 자체는 정상 동작해야 한다.
        console.warn("[sw] 서비스 워커 등록 실패:", err);
      }
    };

    void register();
  }, []);

  return null;
}
