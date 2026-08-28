/**
 * 메인 화면 — 종목 검색 (D-06, 2026-08-28)
 *
 * ── 왜 검색이 기본 진입점인가 ────────────────────────────────────
 *
 * 로그인 도입(D-05) 전에는 `/` 가 항상 관심종목이었다 — "같은 주소가
 * 때에 따라 다른 화면을 보여주는 것"이 혼란스럽다는 이유였다(§3.1).
 * 그런데 관심종목이 이제 로그인한 회원만 볼 수 있게 되면서, 로그인 안 한
 * 방문자에게 `/` 가 "로그인이 필요합니다"만 보여주는 건 첫 화면으로
 * 나쁘다 — 로그인 없이도 누구나 쓸 수 있는 기능(검색·위치·흐름 조회)이
 * 이미 있는데 그걸 첫 화면에서 가리는 꼴이다.
 *
 * 그래서 `/` 는 이제 검색이다. 관심종목은 `/watchlist` 로 옮겼고,
 * 로그인 안 한 사람이 그리로 들어가면 그 라우트 안에서 로그인을
 * 요구한다(`WatchlistScreen` 의 `LoginGate`) — "관심종목을 누르면 그때
 * 로그인하라고 한다"는 요구사항이 여기서 지켜진다.
 */

import { DisclaimerBar } from "@/components/DisclaimerBar";
import { SearchScreen } from "@/components/SearchScreen";

export default function Home() {
  return (
    <>
      <SearchScreen />
      <DisclaimerBar />
    </>
  );
}
