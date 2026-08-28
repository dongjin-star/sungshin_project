/**
 * Supabase Auth 에러 → 한국어 안내 문구.
 *
 * Supabase는 에러를 영문 메시지로만 내려준다. 메시지 문자열로 분기하는
 * 건 취약하지만(문구가 바뀌면 매칭이 깨진다), Supabase JS가 안정적인
 * 에러 코드를 계속 제공하지 않는 경우가 많아 현재로선 이게 가장 실용적인
 * 방법이다 — 매칭에 실패해도 아래 기본 문구로 떨어지므로 화면이 깨지진
 * 않는다.
 */
export function authErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const msg = raw.toLowerCase();

  if (msg.includes("invalid login credentials")) {
    return "이메일 또는 비밀번호가 올바르지 않습니다.";
  }
  if (msg.includes("user already registered") || msg.includes("already registered")) {
    return "이미 가입된 이메일입니다. 로그인을 시도해 주세요.";
  }
  if (msg.includes("password should be at least")) {
    return "비밀번호는 최소 6자 이상이어야 합니다.";
  }
  if (msg.includes("unable to validate email address") || msg.includes("invalid email")) {
    return "이메일 형식이 올바르지 않습니다.";
  }
  if (msg.includes("email not confirmed")) {
    return "이메일 인증이 완료되지 않았습니다.";
  }
  if (msg.includes("rate limit")) {
    return "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.";
  }
  if (msg.includes("failed to fetch") || msg.includes("network")) {
    return "네트워크 연결을 확인해 주세요.";
  }

  return "문제가 발생했습니다. 잠시 후 다시 시도해 주세요.";
}
