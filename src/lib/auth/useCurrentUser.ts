"use client";

/**
 * 현재 로그인한 사용자 (Phase 2 준비, 2026-08-28).
 *
 * "로그인한 사람이 누구인지"를 다른 기능(관심종목 서버 저장 등)이 매번
 * 새로 구독 로직을 짜지 않고 가져다 쓰도록 훅 하나로 뺐다. Supabase
 * 세션 구독 방식이 바뀌어도 이 훅의 반환 모양(`{ user, loading }`)만
 * 지키면 호출부는 안 건드려도 된다.
 */

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";

import { supabase } from "../supabase/client";

export interface CurrentUser {
  /** 로그인 안 했으면 null. 로그인 여부 판정 로직 위쪽에서 새로 만들지 말고 이 값을 쓴다 */
  user: User | null;
  /** 최초 세션 확인이 끝나기 전. true인 동안은 "로그인 안 함"으로 단정하지 않는다 */
  loading: boolean;
}

export function useCurrentUser(): CurrentUser {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Supabase 설정이 없으면(client.ts 참고) 로그인 기능 자체가 꺼진
    // 것이다 — "로그인 안 함"으로 단정하고 나머지 화면은 그대로 쓰게 둔다.
    if (supabase === null) {
      setLoading(false);
      return;
    }

    let alive = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      setUser(data.session?.user ?? null);
      setLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!alive) return;
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => {
      alive = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  return { user, loading };
}

/** 이메일 로컬 파트를 표시 이름으로 쓴다 — 가입 시 별도 이름을 받지 않는다 */
export function displayNameOf(user: User): string {
  return user.email?.split("@")[0] ?? "사용자";
}
