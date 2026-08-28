/**
 * 다크모드 localStorage 키만 따로 뺀 모듈 (D-03).
 *
 * `"use client"` 표시가 없는 순수 데이터 모듈이다 — `layout.tsx`(서버
 * 컴포넌트)의 FOUC 방지 스크립트와 `theme.ts`(클라이언트)가 이 값을
 * 하나로 공유해야 하는데, 클라이언트 경계가 있는 모듈의 상수를 서버
 * 컴포넌트에서 직접 import하면 값이 `undefined` 로 넘어온다 — 실제로
 * 겪은 버그다. 그래서 상수 하나만 경계 밖으로 뺐다.
 */
export const THEME_STORAGE_KEY = "posture.theme.v1";
