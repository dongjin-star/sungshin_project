/**
 * 진입점 (PRD §3.1)
 *
 * §3.1 이 정한 분기를 그대로 구현한다.
 *
 *     관심종목 있음 → 화면 5 (관심종목)   ← 기본 진입점
 *     관심종목 없음 → 화면 1 (종목 검색)
 *
 * 근거는 §3.2 ① — 페르소나 A·C 의 재방문 동기는 "내 종목 확인"이다.
 * 매번 검색부터 시작하게 하면 재방문 비용이 커진다. 최초 방문자만 검색으로
 * 보낸다.
 *
 * ── 왜 리다이렉트가 아니라 한 경로에서 갈라지는가 ────────────────
 *
 * 관심종목은 localStorage 에 있어서 **서버는 어느 쪽을 보여줄지 모른다.**
 * 서버에서 리다이렉트할 수 없고, 클라이언트에서 `router.replace` 를 쓰면
 * 주소가 한 번 튀고 뒤로가기 이력이 지저분해진다. 같은 주소에서 갈라지는
 * 편이 사용자에게 자연스럽다.
 */

"use client";

import { SearchScreen } from "@/components/SearchScreen";
import { DisclaimerBar } from "@/components/DisclaimerBar";
import { WatchlistScreen } from "@/components/watchlist/WatchlistScreen";
import { useWatchlist } from "@/lib/watchlist/store";

export default function Home() {
  const { items, ready } = useWatchlist();

  return (
    <>
      {/* 저장소를 읽기 전에는 어느 쪽도 단정하지 않는다. 한 프레임이면 끝나며,
          여기서 검색 화면을 먼저 그리면 관심종목 사용자에게 매번 깜빡인다. */}
      {!ready ? <Booting /> : items.length > 0 ? <WatchlistScreen /> : <SearchScreen />}
      <DisclaimerBar />
    </>
  );
}

/** §5.7 상태 전이도의 BOOTING */
function Booting() {
  return (
    <div style={{ padding: "1.25rem 1rem" }} aria-busy="true" aria-label="불러오는 중">
      <span
        style={{
          display: "block",
          width: "35%",
          height: 24,
          background: "var(--surface)",
          borderRadius: 6,
        }}
      />
    </div>
  );
}
