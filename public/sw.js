/**
 * 서비스 워커 — 앱 셸만 캐싱한다. 시세는 절대 캐싱하지 않는다.
 *
 * ⚠️ 이 파일에서 가장 중요한 규칙은 파일 맨 아래, `fetch` 리스너 안에
 *    있다 — "여기서부터는 캐싱하지 않는다"로 표시해 뒀다. 캐싱 로직을
 *    추가할 일이 있으면 그 표시 **아래**(캐시 적용 분기)에만 추가한다.
 *    표시 위쪽(네트워크 전용 분기)에 무언가를 추가하면 안 된다.
 *
 * 왜 시세를 캐싱하지 않는가: 이 앱은 실시간에 가까운 가격을 다룬다.
 * 서비스 워커가 어제 응답을 캐시해 두면, 오프라인에서도 "정상적으로
 * 조회된 것"처럼 보이는 화면이 뜬다 — 사용자는 낡은 가격을 최신으로
 * 오해한다. 오프라인 안내("마지막 확인: N분 전")는 프론트 상태
 * 관리가 맡는다. 서비스 워커는 API 요청을 그냥 실패하게 둔다 —
 * 그 실패 자체가 프론트의 판단 근거가 된다.
 */

// v3 — 아이콘을 추상 마크에서 캐릭터 얼굴로 교체(D-05). 파일 경로는 그대로라
// 버전을 안 올리면 이미 설치한 사용자는 옛 아이콘을 계속 들고 있게 된다.
const SHELL_CACHE = "posture-shell-v3";

/**
 * 설치 시 미리 받아두는 것 — 앱 셸뿐이다.
 *
 *   · manifest·아이콘 — 홈 화면 설치에 필요
 *   · 포즈 이미지 6장 — 종목 상세 화면 2의 캐릭터. 파일명이 고정이라
 *     미리 받아둘 수 있다 (public/poses/*.webp)
 *
 * Next.js 의 JS/CSS 번들은 여기 넣지 않는다 — 파일명에 매 빌드마다
 * 바뀌는 콘텐츠 해시가 붙어서, 정적 목록에 하드코딩하면 다음 배포
 * 순간 깨진 채로 남는다. 대신 아래 fetch 리스너가 실제로 요청되는
 * 대로(script/style destination) 그때그때 채워 넣는다 — 첫 방문 때
 * 자연히 캐시가 쌓이고, 오래된 배포의 캐시는 activate 단계에서
 * 버전째 통째로 버려진다.
 */
const SHELL_PRECACHE = [
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/apple-touch-icon.png",
  "/poses/foot.webp",
  "/poses/knee.webp",
  "/poses/waist.webp",
  "/poses/chest.webp",
  "/poses/shoulder.webp",
  "/poses/head.webp",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_PRECACHE))
      // 프리캐시 중 하나가 실패해도(예: 로컬 개발에서 아이콘이 아직 없음)
      // 설치 자체를 막지 않는다 — 앱 셸 일부가 비는 것이, 서비스 워커가
      // 아예 안 뜨는 것보다 낫다.
      .catch((err) => console.warn("[sw] 프리캐시 일부 실패:", err)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== SHELL_CACHE) // 버전이 바뀐 이전 캐시는 전부 정리
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

/**
 * 절대 캐싱하지 않을 경로. 이 배열에 걸리면 fetch 리스너가 아예
 * 관여하지 않고 브라우저 기본 네트워크 요청 그대로 내보낸다.
 *
 *   /api/*            — /api/stock/{symbol}, /api/watchlist, /api/quotes 등
 *   /search-index.json — 종목 마스터. API 라우트는 아니지만(정적 파일,
 *                        D-04) 같은 이유로 제외한다: 매일 갱신되는
 *                        배치 산출물이라 "낡은 걸 최신처럼" 보일 위험이
 *                        같다. HTTP 캐시(Cache-Control)가 이미 하루
 *                        단위로 신선도를 관리하고 있어 서비스 워커가
 *                        한 번 더 얹을 이유도 없다.
 */
const NEVER_CACHE = [/^\/api\//, /^\/search-index\.json$/];

function isNeverCache(pathname) {
  return NEVER_CACHE.some((pattern) => pattern.test(pathname));
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // GET 이 아니면 손대지 않는다 — POST 등 변경 요청에 캐시 로직이
  // 끼어들 이유가 없다.
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // 다른 출처(토스 API 등)는 손대지 않는다. 이 서비스 워커는 같은
  // 출처의 앱 셸만 다룬다.
  if (url.origin !== self.location.origin) return;

  // ════════════════════════════════════════════════════════════════
  // 🔴 여기서부터 캐싱하지 않는다. 이 분기 위쪽에 캐싱 로직을 추가하지
  //    않는다 — 추가하면 시세 API가 캐시를 타게 된다.
  // ════════════════════════════════════════════════════════════════
  if (isNeverCache(url.pathname)) {
    return; // respondWith 를 부르지 않는다 = 그대로 네트워크로 나간다
  }

  // 🔴 문서(페이지 내비게이션)와 Next.js 내부 라우팅 요청도 캐싱하지
  //    않는다 — v1 에서 실제로 겪은 배포 사고다.
  //
  //    Next App Router 는 같은 URL(예: /search)이라도 요청 종류에 따라
  //    다른 형식으로 응답한다 — 브라우저 주소창 이동/새로고침은 HTML
  //    문서 전체를, `<Link>` 클릭 등 클라이언트 내비게이션은 `RSC: 1`
  //    헤더가 붙은 요청에 대해 RSC 페이로드(HTML이 아니다)를 내려준다.
  //    캐시가 이 둘을 구분하지 못하고 한쪽으로 응답한 걸 다른 쪽에
  //    재생하면, 라우팅이 깨지거나 페이지가 아예 안 뜬다 — Chrome 에서만
  //    재현된 이유도 이거다: 캐시가 브라우저별로 따로 쌓이니, 이미 잘못된
  //    조합을 캐싱해 둔 브라우저에서만 증상이 남는다.
  //
  //    이 위험을 원천 차단하는 가장 안전한 방법은 문서·내비게이션 요청을
  //    아예 캐시 대상에서 빼는 것이다 — 아래에서 다시 열지 않는다.
  if (request.mode === "navigate" || request.headers.get("RSC") === "1") {
    return;
  }
  // ════════════════════════════════════════════════════════════════
  // 🔴 여기까지. 아래부터는 스크립트·스타일·이미지·폰트 같은 "진짜
  //    정적 자산"만 남는다 — URL 하나가 항상 같은 내용이라 캐싱이
  //    안전하다. 문서·API 는 여기 포함되지 않는다.
  // ════════════════════════════════════════════════════════════════
  const CACHEABLE_DESTINATIONS = ["script", "style", "image", "font", "manifest"];
  if (!CACHEABLE_DESTINATIONS.includes(request.destination)) return;

  // 정적 자산: stale-while-revalidate. 캐시가 있으면 즉시 그것을 주고
  // (오프라인에서도 뜬다), 백그라운드로 최신 버전을 받아 다음 방문을
  // 위해 캐시를 갱신한다.
  event.respondWith(
    caches.open(SHELL_CACHE).then(async (cache) => {
      const cached = await cache.match(request);

      const network = fetch(request)
        .then((response) => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => null);

      // network 응답은 여기서 기다리지 않는다 — 캐시가 있으면 그걸로
      // 바로 응답하고, 최신화는 백그라운드에서 진행한다. 다만
      // waitUntil 로 브라우저에 "이 작업 끝날 때까지 워커를 죽이지
      // 말라"고 알려야, respondWith 가 끝난 뒤에도 캐시 갱신이
      // 실제로 완료된다 — 안 하면 백그라운드 fetch 가 중간에 잘릴 수
      // 있다.
      event.waitUntil(network);

      if (cached) return cached;

      const fresh = await network;
      if (fresh) return fresh;

      // 캐시도 없고 네트워크도 실패 — 여기가 진짜 오프라인이다.
      return new Response("오프라인 상태입니다.", {
        status: 503,
        statusText: "Offline",
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }),
  );
});
