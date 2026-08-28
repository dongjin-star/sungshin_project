/**
 * 관심종목 (PRD §5.6, D-06 2026-08-28로 `/` 에서 이 경로로 이동)
 *
 * 로그인한 회원 전용 기능이다. 비로그인 방문자가 여기로 오면
 * `WatchlistScreen` 안의 `LoginGate` 가 로그인을 요구한다 — 라우트
 * 자체는 누구나 접근 가능하지만(그래야 "로그인하라"는 안내라도 보여줄
 * 수 있다), 실제 목록은 로그인해야 보인다.
 */

import { DisclaimerBar } from "@/components/DisclaimerBar";
import { WatchlistScreen } from "@/components/watchlist/WatchlistScreen";

export default function WatchlistPage() {
  return (
    <>
      <WatchlistScreen />
      <DisclaimerBar />
    </>
  );
}
