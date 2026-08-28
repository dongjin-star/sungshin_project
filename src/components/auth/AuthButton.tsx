"use client";

/**
 * 헤더의 로그인 상태 표시 (2026-08-28).
 *
 * 비로그인 → "로그인" 버튼(모달 오픈). 로그인 → "{이름}님 로그아웃".
 * 로그인 여부는 useCurrentUser 하나로 판정한다 — 이 컴포넌트가 세션을
 * 직접 구독하지 않는다.
 */

import { useState } from "react";

import { supabase } from "@/lib/supabase/client";
import { displayNameOf, useCurrentUser } from "@/lib/auth/useCurrentUser";
import { AuthModal } from "./AuthModal";

export function AuthButton() {
  const { user, loading } = useCurrentUser();
  const [modalOpen, setModalOpen] = useState(false);

  if (loading) {
    // 세션 확인 전에는 아무것도 보여주지 않는다 — "로그인" 버튼이 잠깐
    // 떴다가 로그인 상태로 바뀌는 깜빡임을 피한다.
    return null;
  }

  if (user) {
    return (
      <button
        type="button"
        onClick={() => void supabase?.auth.signOut()}
        style={buttonStyle}
      >
        {displayNameOf(user)}님 로그아웃
      </button>
    );
  }

  return (
    <>
      <button type="button" onClick={() => setModalOpen(true)} style={buttonStyle}>
        로그인
      </button>
      {modalOpen && <AuthModal onClose={() => setModalOpen(false)} />}
    </>
  );
}

const buttonStyle: React.CSSProperties = {
  padding: "0.375rem 0.625rem",
  border: "1px solid var(--border)",
  borderRadius: 8,
  background: "transparent",
  color: "var(--text-muted)",
  fontSize: "0.75rem",
  fontWeight: 600,
  cursor: "pointer",
  whiteSpace: "nowrap",
  minHeight: 36,
};
