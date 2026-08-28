"use client";

/**
 * Supabase 브라우저 클라이언트 (로그인 기능, 2026-08-28)
 *
 * publishable 키는 브라우저에 노출돼도 되는 값이다 — RLS가 실제 접근
 * 제어를 담당한다(§6.3). 그래서 `NEXT_PUBLIC_` 접두사를 쓰고, 토스/Gemini
 * 자격증명처럼 `server-only` 로 감싸지 않는다.
 *
 * 세션은 기본 설정 그대로 브라우저 localStorage에 저장된다 — 새로고침해도
 * 로그인이 유지돼야 한다는 요구사항이 이 기본값만으로 충족된다.
 *
 * ── 왜 키가 없어도 throw 하지 않는가 ──────────────────────────────
 *
 * 이 파일은 클라이언트 컴포넌트라도 Next.js가 정적 페이지를 만들 때
 * 빌드 시점에 한 번 실행한다. 여기서 throw 하면 로그인 기능 하나가
 * 아니라 **빌드 전체**가 죽는다 — 실제로 겪었다(.env.local 에서
 * 이 값들이 빠진 채로 빌드해서 `/` 프리렌더가 통째로 실패했다). 토스·
 * Gemini 키가 없을 때 그 기능만 에러 나고 나머지는 정상 동작하는
 * 것과 같은 원칙을, 여기서는 `supabase`를 null로 두고 호출부
 * (`useCurrentUser`, `AuthModal`)가 그 null을 확인하는 방식으로 지킨다.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  console.warn(
    "[supabase] NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY 가 설정되지 않았습니다 — 로그인 기능이 비활성화됩니다.",
  );
}

export const supabase: SupabaseClient | null = url && key ? createClient(url, key) : null;
