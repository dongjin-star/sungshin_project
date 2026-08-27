/**
 * ⓘ 계산 근거 시트 (PRD §5.3 ⑨, PP-03)
 *
 * "계산 근거·기준 기간·데이터 한계를 숨기지 않는다"(§1.3 정직)를 실행하는
 * 곳이다. 사용자가 수치를 의심할 때 답이 앱 안에 있어야 한다.
 */

"use client";

import { useEffect, useRef } from "react";

interface Props {
  title: string;
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

export function InfoSheet({ title, open, onClose, children }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);

  // Esc 로 닫힌다. 열릴 때 포커스를 시트 안으로 옮겨 키보드 사용자가 갇히지 않게 한다.
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
      }}
    >
      <button
        type="button"
        aria-label="닫기"
        onClick={onClose}
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(23, 24, 28, 0.4)",
          border: "none",
          cursor: "pointer",
        }}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{
          position: "relative",
          width: "100%",
          maxWidth: "var(--app-width)",
          maxHeight: "80dvh",
          overflowY: "auto",
          background: "var(--bg)",
          borderRadius: "16px 16px 0 0",
          padding: "1.25rem 1rem calc(1.5rem + env(safe-area-inset-bottom))",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem" }}>
          <h2 style={{ margin: 0, fontSize: "1rem", fontWeight: 700 }}>{title}</h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            style={{
              flexShrink: 0,
              width: 32,
              height: 32,
              border: "none",
              borderRadius: 8,
              background: "var(--surface-strong)",
              color: "var(--text-muted)",
              fontSize: "1rem",
              cursor: "pointer",
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ marginTop: "1rem", fontSize: "0.8125rem", lineHeight: 1.7, color: "var(--text-muted)" }}>
          {children}
        </div>
      </div>
    </div>
  );
}

/** 시트 안의 한 항목 */
export function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: "0.875rem" }}>
      <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text)" }}>{label}</div>
      <div style={{ marginTop: "0.125rem" }}>{children}</div>
    </div>
  );
}

/** 본문 옆에 붙는 작은 ⓘ 버튼 */
export function InfoButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      style={{
        flexShrink: 0,
        width: 20,
        height: 20,
        padding: 0,
        border: "none",
        borderRadius: "50%",
        background: "var(--surface-strong)",
        color: "var(--text-muted)",
        fontSize: "0.6875rem",
        lineHeight: "20px",
        cursor: "pointer",
      }}
    >
      ⓘ
    </button>
  );
}
