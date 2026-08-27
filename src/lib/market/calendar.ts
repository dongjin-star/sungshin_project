/**
 * 장 운영 상태 판정 (PRD §12.3, F-STATE-03)
 *
 * §12.3 의 두 규칙을 그대로 옮긴 것이다.
 *   · "프리·애프터마켓 시세는 사용하지 않는다" → OPEN 은 **정규장 구간뿐**
 *   · "서머타임은 하드코딩하지 않고 항상 캘린더 API 응답을 신뢰한다"
 *
 * ⚠️ 실측: KR 과 US 의 응답 구조가 다르다.
 *      KR → today.integrated.{preMarket, regularMarket, afterMarket}
 *      US → today.{dayMarket, preMarket, regularMarket, afterMarket}
 *    시각은 양쪽 다 `+09:00` 오프셋으로 온다.
 */

import { TtlCache, TTL } from "../cache/memory";
import { tossGet } from "../toss/core";
import type { Market } from "../types";

export type MarketState = "OPEN" | "CLOSED" | "HOLIDAY";

interface Session {
  startTime?: string;
  endTime?: string;
}

interface DayEntry {
  date?: string;
  /** 국내 전용 — 세션들이 한 겹 더 들어간다 */
  integrated?: { regularMarket?: Session };
  /** 미국 전용 */
  regularMarket?: Session;
}

interface CalendarResult {
  today?: DayEntry | null;
  previousBusinessDay?: DayEntry | null;
  nextBusinessDay?: DayEntry | null;
}

const cache = new TtlCache<CalendarResult>(TTL.CALENDAR_MS, 8);

export async function fetchCalendar(market: Market): Promise<CalendarResult> {
  return cache.getOrLoad(market, () =>
    tossGet<CalendarResult>(`/api/v1/market-calendar/${market}`, "MARKET_INFO"),
  );
}

/** KR·US 구조 차이를 여기서 한 번만 흡수한다 */
function regularSessionOf(day: DayEntry | null | undefined): Session | null {
  if (!day) return null;
  return day.integrated?.regularMarket ?? day.regularMarket ?? null;
}

/** 정규장 구간이 실제로 파싱 가능한 형태인가 */
function sessionWindow(day: DayEntry | null | undefined): { start: number; end: number } | null {
  const session = regularSessionOf(day);
  if (session?.startTime === undefined || session.endTime === undefined) return null;

  const start = Date.parse(session.startTime);
  const end = Date.parse(session.endTime);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;

  return { start, end };
}

/**
 * 지금 정규장이 열려 있는 날짜 항목을 찾는다.
 *
 * ⚠️ **`today` 만 봐서는 안 된다.** 토스 캘린더의 `today` 는 KST 날짜 기준인데
 *    미국 정규장은 KST 자정을 가로지른다 (22:30 → 다음날 05:00 KST).
 *
 *    실측 (2026-08-28 00:49 KST = 08-27 11:49 ET, NYSE 정규장 한복판):
 *      today.date            = 2026-08-28, 정규장 08-28 22:30 → 08-29 05:00
 *      previousBusinessDay   = 2026-08-27, 정규장 08-27 22:30 → 08-28 05:00  ← 지금 이것
 *
 *    즉 00:00~05:00 KST 구간 — 미국 세션의 뒤쪽 5시간 — 이 통째로
 *    `previousBusinessDay` 에 들어간다. `today` 만 보면 매 세션의 대부분을
 *    장 마감으로 잘못 판정하고, `isRealtime` 이 false 로 내려가면서 §7.4 의
 *    "장중에는 현재가로 MA 보정" 분기까지 어긋난다.
 *
 *    그래서 세 항목을 모두 훑는다. 어느 날짜에 적혀 있든 **지금 돌아가는
 *    세션이 있으면 그것이 사실이다.**
 */
function activeDay(calendar: CalendarResult, now: Date): DayEntry | null {
  const t = now.getTime();
  for (const day of [calendar.previousBusinessDay, calendar.today, calendar.nextBusinessDay]) {
    const window = sessionWindow(day);
    if (window === null) continue;
    if (t >= window.start && t < window.end) return day ?? null;
  }
  return null;
}

/**
 * 장 상태 판정.
 *
 * HOLIDAY 와 CLOSED 를 나누는 이유는 화면 문구가 갈리기 때문이다 (§12.3).
 * "휴장일 — N월 N일 종가 기준" 과 "장 종료 · 종가 기준" 은 다른 말이다.
 *
 * 정규장 구간만 OPEN 이다. 프리·애프터마켓은 CLOSED 로 본다 (§12.3).
 */
export function marketStateOf(calendar: CalendarResult, now: Date = new Date()): MarketState {
  // 지금 돌아가는 정규장이 있으면 그것이 사실이다 (날짜 항목과 무관하게)
  if (activeDay(calendar, now) !== null) return "OPEN";

  // 오늘이 영업일이 아니면 캘린더가 today 를 주지 않거나 정규장 구간이 없다
  if (sessionWindow(calendar.today) === null) return "HOLIDAY";

  return "CLOSED";
}

/**
 * 종가의 기준이 되는 거래일.
 *
 * 장이 열려 있으면 **그 세션이 속한 날짜**, 아니면 직전 영업일이다.
 * "N월 N일 종가 기준" 문구가 이 값을 쓴다.
 *
 * OPEN 일 때 `calendar.today.date` 를 쓰면 안 된다 — 위 `activeDay` 주석의
 * 이유로 지금 열려 있는 세션이 `previousBusinessDay` 에 적혀 있을 수 있다.
 */
export function referenceTradeDate(
  calendar: CalendarResult,
  state: MarketState,
  now: Date = new Date(),
): string | null {
  if (state === "OPEN") {
    return activeDay(calendar, now)?.date ?? calendar.today?.date ?? null;
  }
  return calendar.previousBusinessDay?.date ?? calendar.today?.date ?? null;
}

/** 테스트용 */
export function __clearCalendarCache(): void {
  cache.clear();
}
