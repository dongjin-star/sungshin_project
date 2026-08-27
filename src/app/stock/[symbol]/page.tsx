/**
 * 화면 2·3·4 — 종목 상세 (PRD §5.3~§5.5, Phase 1-5)
 *
 * 데이터는 클라이언트가 `GET /api/stock/{symbol}` 로 한 번 받는다. 서버에서
 * 미리 받아 넘기지 않는 이유는 §10.4 의 캐시가 **프로세스 안**에 있어서,
 * 어느 쪽에서 부르든 같은 캐시를 타기 때문이다. 클라이언트에서 부르면
 * 첫 페인트가 데이터를 기다리지 않는다는 이점만 더 생긴다.
 */

import { DisclaimerBar } from "@/components/DisclaimerBar";
import { StockScreen } from "@/components/stock/StockScreen";

export default async function StockPage({
  params,
}: {
  params: Promise<{ symbol: string }>;
}) {
  const { symbol } = await params;

  return (
    <>
      <StockScreen symbol={decodeURIComponent(symbol)} />
      <DisclaimerBar />
    </>
  );
}
