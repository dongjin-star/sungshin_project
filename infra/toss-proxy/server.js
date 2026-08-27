#!/usr/bin/env node
"use strict";

/**
 * 최소 인증 포워드 프록시 (PRD §0.3 P-02 대응)
 *
 * Vercel 서버리스 함수는 요청마다 아웃바운드 IP가 바뀐다. 토스 API 는
 * WTS 에 등록한 고정 IP 가 아니면 403 으로 막는다. 이 프록시를 고정
 * 아웃바운드 IP 를 가진 환경(Fly.io dedicated IPv4)에 올려두고, 토스로
 * 나가는 요청만 이걸 거치게 하면 앱 본체는 Vercel 에 그대로 둘 수 있다.
 *
 * ── 왜 CONNECT 하나만 구현했는가 ─────────────────────────────────
 *
 * 토스 API 는 전부 HTTPS 다. HTTP 프록시가 HTTPS 목적지를 중계할 때는
 * CONNECT 로 목적지까지 **암호화되지 않은 TCP 터널만** 열어주고, 그 위의
 * TLS 는 클라이언트(Vercel 쪽 Node 프로세스)와 토스 서버가 직접 맺는다.
 * 즉 이 프록시는 CONNECT 요청·인증 헤더만 볼 뿐, 실제 요청 본문·토큰·
 * 응답은 절대 복호화해서 볼 수 없다. Proxy-Authorization 자격만 이
 * 구간을 평문으로 지난다 — 토스 client_secret 이나 access_token 은
 * 여기 지나가지 않는다.
 *
 * ── 오픈 릴레이가 되지 않도록 ────────────────────────────────────
 *
 * 인증 없이는 절대 뜨지 않고(시작 시 검사), 목적지도 허용 목록 밖이면
 * 무조건 거절한다. 이 프록시의 IP 는 토스 WTS 에 등록해 둘 값이라,
 * 누구나 쓸 수 있는 릴레이로 새면 그 IP 로 나가는 모든 트래픽이
 * "우리 서비스가 보낸 요청"으로 보인다.
 */

const http = require("node:http");
const net = require("node:net");
const { URL } = require("node:url");

const PORT = Number(process.env.PORT || 8080);
const USER = process.env.PROXY_USER;
const PASS = process.env.PROXY_PASS;
const ALLOWED_HOSTS = (process.env.ALLOWED_HOSTS || "openapi.tossinvest.com")
  .split(",")
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);

if (!USER || !PASS) {
  console.error(
    "🔴 PROXY_USER / PROXY_PASS 가 설정되지 않았다. 인증 없는 프록시는 띄우지 않는다.",
  );
  process.exit(1);
}

if (ALLOWED_HOSTS.length === 0) {
  console.error("🔴 ALLOWED_HOSTS 가 비어 있다. 목적지 허용 목록 없이는 띄우지 않는다.");
  process.exit(1);
}

function checkAuth(req) {
  const header = req.headers["proxy-authorization"];
  if (!header || !header.startsWith("Basic ")) return false;

  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  const sep = decoded.indexOf(":");
  if (sep === -1) return false;

  return decoded.slice(0, sep) === USER && decoded.slice(sep + 1) === PASS;
}

function hostAllowed(hostname) {
  return ALLOWED_HOSTS.includes(hostname.toLowerCase());
}

const server = http.createServer((_req, res) => {
  // CONNECT 이외의 일반 HTTP 요청은 다루지 않는다 — 토스 API 는 https 뿐이다.
  res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("이 프록시는 CONNECT(HTTPS 터널링)만 지원한다.\n");
});

server.on("connect", (req, clientSocket, head) => {
  clientSocket.on("error", () => {
    /* 클라이언트가 먼저 끊는 것은 정상 흐름이다 */
  });

  if (!checkAuth(req)) {
    clientSocket.write(
      "HTTP/1.1 407 Proxy Authentication Required\r\n" +
        'Proxy-Authenticate: Basic realm="toss-proxy"\r\n\r\n',
    );
    clientSocket.end();
    return;
  }

  let target;
  try {
    // CONNECT 의 요청 대상은 "host:port" 형태다 (스킴이 없다)
    target = new URL(`tcp://${req.url}`);
  } catch {
    clientSocket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
    return;
  }

  if (!hostAllowed(target.hostname)) {
    console.warn(`거부: 허용 목록에 없는 목적지 ${target.hostname}`);
    clientSocket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    clientSocket.end();
    return;
  }

  const port = Number(target.port) || 443;
  const serverSocket = net.connect(port, target.hostname, () => {
    clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    serverSocket.write(head);
    serverSocket.pipe(clientSocket);
    clientSocket.pipe(serverSocket);
  });

  serverSocket.on("error", (err) => {
    console.error(`업스트림 연결 오류 (${target.hostname}:${port}):`, err.message);
    clientSocket.end();
  });
});

server.listen(PORT, () => {
  console.log(`toss-proxy 대기 중 :${PORT} — 허용 목적지: ${ALLOWED_HOSTS.join(", ")}`);
});
