"use client";

/**
 * 로그인/회원가입 모달 (2026-08-28, 닉네임 추가 2026-08-28).
 *
 * 비밀번호 처리는 전부 Supabase에 맡긴다 — 이 컴포넌트는 이메일·비밀번호
 * 문자열을 그대로 `supabase.auth.*` 에 넘길 뿐, 해싱·검증 로직을 직접
 * 짜지 않는다.
 *
 * "회원가입" 을 누르면 그 자리에서 바로 가입시키지 않는다 — 모달이
 * 닉네임 입력 화면으로 바뀌고, 거기서 "가입하기" 를 눌러야 실제 요청이
 * 나간다. 닉네임은 별도 테이블 없이 Supabase Auth의 `user_metadata` 에
 * 저장한다 — 로그인 상태 표시("OOO님 로그아웃")가 이 값을 그대로 쓴다
 * (`displayNameOf`, useCurrentUser.ts).
 *
 * 회원가입은 이메일 인증 대기 없이 바로 로그인돼야 한다(요구사항). 이건
 * Supabase 프로젝트의 Auth 설정("Confirm email" 끔)이 전제 조건이고,
 * 그 설정이 켜져 있어도 화면이 깨지지 않도록 signUp 응답에 세션이 없으면
 * signInWithPassword로 한 번 더 시도하는 보강을 넣었다.
 */

import { useEffect, useId, useRef, useState } from "react";

import { supabase } from "@/lib/supabase/client";
import { authErrorMessage } from "@/lib/auth/error-messages";

type View = "signin" | "signup";

export function AuthModal({ onClose }: { onClose: () => void }) {
  const [view, setView] = useState<View>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [nickname, setNickname] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const titleId = useId();
  const firstFieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstFieldRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, view]);

  const goToSignup = () => {
    setError(null);
    setView("signup");
  };

  const goToSignin = () => {
    setError(null);
    setView("signin");
  };

  const submitSignin = async () => {
    if (busy || supabase === null) {
      if (supabase === null) setError("로그인 기능을 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const { error: err } = await supabase.auth.signInWithPassword({ email, password });
      if (err) throw err;
      onClose();
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const submitSignup = async () => {
    if (busy || supabase === null) {
      if (supabase === null) setError("로그인 기능을 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.");
      return;
    }
    if (nickname.trim().length === 0) {
      setError("닉네임을 입력해 주세요.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const { data, error: err } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { nickname: nickname.trim() } },
      });
      if (err) throw err;
      // "Confirm email" 이 꺼져 있으면 여기서 이미 세션이 온다. 혹시
      // 켜져 있어도(설정 반영 지연 등) 조용히 실패하지 않도록 한 번 더
      // 로그인을 시도한다 — 그래도 안 되면(실제로 인증 대기가 걸린
      // 경우) 아래 catch가 아니라 이 블록을 그냥 통과해 모달이 닫히고,
      // 사용자는 다음 로그인 때 이메일 인증 안내를 보게 된다.
      if (!data.session) {
        const { error: retryErr } = await supabase.auth.signInWithPassword({ email, password });
        if (retryErr) throw retryErr;
      }
      onClose();
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
        padding: "1rem",
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={{
          width: "100%",
          maxWidth: 340,
          background: "var(--bg)",
          borderRadius: 14,
          padding: "1.5rem",
          boxShadow: "0 20px 60px rgba(0, 0, 0, 0.25)",
        }}
      >
        <h2 id={titleId} style={{ margin: "0 0 1rem", fontSize: "1.0625rem", fontWeight: 700 }}>
          {view === "signin" ? "로그인" : "회원가입"}
        </h2>

        <form
          onSubmit={(e) => e.preventDefault()}
          style={{ display: "flex", flexDirection: "column", gap: "0.625rem" }}
        >
          <label style={{ display: "block" }}>
            <span style={{ display: "block", fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: 4 }}>
              이메일
            </span>
            <input
              ref={firstFieldRef}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              style={inputStyle}
            />
          </label>

          <label style={{ display: "block" }}>
            <span style={{ display: "block", fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: 4 }}>
              비밀번호
            </span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={view === "signin" ? "current-password" : "new-password"}
              style={inputStyle}
            />
          </label>

          {view === "signup" && (
            <label style={{ display: "block" }}>
              <span style={{ display: "block", fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: 4 }}>
                닉네임
              </span>
              <input
                type="text"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                maxLength={20}
                autoComplete="nickname"
                placeholder="로그인 상태에 표시될 이름"
                style={inputStyle}
              />
            </label>
          )}

          {error && (
            <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--up)" }} role="alert">
              {error}
            </p>
          )}

          {view === "signin" ? (
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.375rem" }}>
              <button
                type="button"
                disabled={busy}
                onClick={() => void submitSignin()}
                style={{ ...actionButtonStyle, background: "var(--accent)", color: "var(--bg)" }}
              >
                로그인
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={goToSignup}
                style={{ ...actionButtonStyle, background: "var(--surface-strong)", color: "var(--text)" }}
              >
                회원가입
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "0.375rem" }}>
              <button
                type="button"
                disabled={busy}
                onClick={() => void submitSignup()}
                style={{ ...actionButtonStyle, background: "var(--accent)", color: "var(--bg)" }}
              >
                가입하기
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={goToSignin}
                style={{
                  padding: "0.375rem",
                  border: "none",
                  background: "transparent",
                  color: "var(--text-muted)",
                  fontSize: "0.8125rem",
                  cursor: "pointer",
                }}
              >
                이미 계정이 있으신가요? 로그인
              </button>
            </div>
          )}
        </form>

        <button
          type="button"
          onClick={onClose}
          style={{
            marginTop: "0.875rem",
            width: "100%",
            padding: "0.5rem",
            border: "none",
            background: "transparent",
            color: "var(--text-subtle)",
            fontSize: "0.75rem",
            cursor: "pointer",
          }}
        >
          닫기
        </button>

        {/* aria-live 로 진행 상태를 스크린리더에도 알린다 */}
        <span className="sr-only" role="status">
          {busy ? (view === "signin" ? "로그인 중" : "회원가입 중") : ""}
        </span>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.625rem 0.75rem",
  border: "1px solid var(--border)",
  borderRadius: 8,
  background: "var(--surface)",
  color: "var(--text)",
  fontSize: "0.9375rem",
  boxSizing: "border-box",
};

const actionButtonStyle: React.CSSProperties = {
  flex: 1,
  padding: "0.625rem",
  border: "none",
  borderRadius: 8,
  fontSize: "0.875rem",
  fontWeight: 600,
  cursor: "pointer",
  minHeight: 40,
};
