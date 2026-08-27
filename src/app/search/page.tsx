/**
 * 화면 1 — 종목 검색 (PRD §5.2)
 *
 * `/` 는 관심종목이 기본 진입점이므로(§3.1), 검색을 다시 열려면 이 경로가
 * 필요하다 — 화면 5 상단의 검색 아이콘이 여기로 온다 (§3.3).
 *
 * 검색 자체는 클라이언트에서 로컬 인덱스로 돈다 (D-04). 서버는 인덱스
 * 정적 파일과 시세 엔드포인트만 준다.
 */

import { SearchScreen } from "@/components/SearchScreen";
import { DisclaimerBar } from "@/components/DisclaimerBar";

export default function SearchPage() {
  return (
    <>
      <SearchScreen />
      <DisclaimerBar />
    </>
  );
}
