/**
 * 화면 1 — 종목 검색 (PRD §5.2)
 *
 * 검색 자체는 클라이언트에서 로컬 인덱스로 돈다 (D-04). 서버는 인덱스
 * 정적 파일과 시세 엔드포인트만 준다.
 */

import { SearchScreen } from "@/components/SearchScreen";
import { DisclaimerBar } from "@/components/DisclaimerBar";

export default function Home() {
  return (
    <>
      <SearchScreen />
      <DisclaimerBar />
    </>
  );
}
