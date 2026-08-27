/**
 * 메인 화면 — 관심종목 (PRD §5.6, §3.1 기본 진입점)
 *
 * ── 왜 항상 관심종목인가 ──────────────────────────────────────────
 *
 * §3.1 은 "관심종목 없음 → 화면 1(검색)"으로 그려져 있고 처음엔 그렇게
 * 만들었다. 그런데 **같은 주소가 때에 따라 다른 화면을 보여주는 것**이
 * 실제로 써보면 혼란스럽다. 종목을 담기 전에는 검색이 뜨고 담은 뒤에는
 * 목록이 뜨니, "내 종목이 어디 있지"를 되묻게 된다.
 *
 * 그래서 `/` 는 언제나 관심종목이다. 담은 게 없으면 §5.6 이 정의한
 * `EMPTY` 상태가 뜨고, 거기서 검색으로 한 번에 갈 수 있다. §3.2 ① 이
 * 말한 "재방문 동기는 내 종목 확인"은 그대로 지켜지고, 최초 방문자가
 * 치르는 비용은 탭 한 번이다.
 *
 * 검색은 `/search` 에 있다 (§3.3 검색 재진입).
 */

import { DisclaimerBar } from "@/components/DisclaimerBar";
import { WatchlistScreen } from "@/components/watchlist/WatchlistScreen";

export default function Home() {
  return (
    <>
      <WatchlistScreen />
      <DisclaimerBar />
    </>
  );
}
