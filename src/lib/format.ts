/**
 * 표시용 포맷팅.
 *
 * PRD §7.6 R-04: "모든 변수는 서버에서 포맷팅 후 전달 (통화 기호·자릿수 포함)".
 * 템플릿 문장에 숫자를 끼워 넣기 전에 반드시 여기를 거친다.
 */

import type { Currency } from "./types";

/**
 * 통화 금액. KRW 는 정수, USD 는 소수 2자리.
 *   74500 KRW → "74,500원"
 *   231.4  USD → "$231.40"
 */
export function formatPrice(value: number, currency: Currency): string {
  if (currency === "KRW") {
    return `${Math.round(value).toLocaleString("ko-KR")}원`;
  }
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** 등락률. -0.0123 → "-1.23%" */
export function formatChangeRate(rate: number): string {
  const pct = rate * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

/** 퍼센타일 표시값. 문장에는 반올림 정수를, 수치 표기에는 소수 1자리를 쓴다 */
export function formatPercentileInt(p: number): string {
  return String(Math.round(p));
}

export function formatPercentileDecimal(p: number): string {
  return p.toFixed(1);
}

/** 이격률. 0.0123 → "1.23%" (부호 없이 크기만) */
export function formatGapRatio(ratio: number): string {
  return `${Math.abs(ratio * 100).toFixed(2)}%`;
}

/** 'YYYY-MM-DD' → "8월 27일" */
export function formatDateKo(isoDate: string): string {
  const [, m, d] = isoDate.split("-");
  if (m === undefined || d === undefined) return isoDate;
  return `${Number(m)}월 ${Number(d)}일`;
}

/** ISO 8601 → "2026-08-27 15:30 기준" 의 앞부분 (§5.1 데이터 시각 상시 표시) */
export function formatAsOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
