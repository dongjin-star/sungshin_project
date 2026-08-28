/**
 * 옛 검색 경로 (D-06, 2026-08-28) — 검색은 이제 `/` 다.
 *
 * 이 파일은 남겨둔 리다이렉트다. 북마크·과거 링크가 `/search` 를 가리킬
 * 수 있으니 깨진 링크로 만드는 대신 홈으로 보낸다.
 */

import { redirect } from "next/navigation";

export default function SearchPage() {
  redirect("/");
}
