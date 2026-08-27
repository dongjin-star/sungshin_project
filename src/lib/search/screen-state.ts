/**
 * 화면 1 의 상태 판정 (PRD §5.2)
 *
 * §5.2 는 검색 화면이 가질 수 있는 상태를 여섯 개로 못박았다. 컴포넌트 안에서
 * `if (loading) … else if (error) …` 식으로 흩어놓으면 두 조건이 동시에 참인
 * 순간에 화면이 깜빡인다 — 특히 디바운스가 걸린 입력에서.
 *
 * 그래서 판정을 **순수 함수 하나로** 몰아두고 컴포넌트는 결과만 그린다.
 * 렌더링과 분리돼 있으므로 DOM 없이 그대로 테스트할 수 있다.
 */

export type ScreenState =
  | "INDEX_LOADING"
  | "INDEX_ERROR"
  | "IDLE"
  | "TYPING"
  | "RESULTS"
  | "EMPTY";

export type IndexStatus = "loading" | "ready" | "error";

/**
 * @param raw       입력창에 지금 들어 있는 값
 * @param debounced 디바운스를 통과해 실제 검색에 쓰인 값
 */
export function resolveState(
  indexStatus: IndexStatus,
  raw: string,
  debounced: string,
  resultCount: number,
): ScreenState {
  // 인덱스가 없으면 무엇을 쳐도 검색할 수 없다. 입력 상태보다 우선한다.
  if (indexStatus === "loading") return "INDEX_LOADING";
  if (indexStatus === "error") return "INDEX_ERROR";

  if (raw.trim().length === 0) return "IDLE";

  // 사용자가 친 것과 디바운스된 값이 다르면 아직 타이핑 중이다.
  // 이 분기가 없으면 마지막 글자를 치는 순간 잠깐 EMPTY 가 스쳐 지나간다.
  if (raw !== debounced) return "TYPING";

  return resultCount > 0 ? "RESULTS" : "EMPTY";
}
