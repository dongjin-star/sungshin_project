#!/usr/bin/env node
"use strict";

/**
 * 배포한 프록시가 실제로 열려 있는지 확인하는 독립 스크립트.
 *
 * 프로젝트 의존성이 전혀 필요 없다 — Node 내장 모듈만 쓴다. Fly.io 배포
 * 직후, Vercel 에 연결하기 전에 먼저 이걸로 확인한다.
 *
 *   node infra/toss-proxy/test-connectivity.js http://user:pass@your-app.fly.dev:8080
 *
 * "✅ CONNECT 성공" 이 나와야 정상이다. 여기서 막히면 Vercel 에 연결해도
 * 똑같이 막힌다 — Fly 배포·시크릿·포트 설정을 먼저 의심한다.
 */

const http = require("node:http");
const { URL } = require("node:url");

const proxyUrl = process.argv[2];
if (!proxyUrl) {
  console.error("사용법: node test-connectivity.js <프록시 URL, 예: http://user:pass@app.fly.dev:8080>");
  process.exit(1);
}

const proxy = new URL(proxyUrl);
const auth =
  proxy.username || proxy.password
    ? `Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString("base64")}`
    : undefined;

const req = http.request({
  host: proxy.hostname,
  port: Number(proxy.port) || 80,
  method: "CONNECT",
  path: "openapi.tossinvest.com:443",
  headers: auth ? { "Proxy-Authorization": auth } : {},
  timeout: 10_000,
});

req.on("connect", (res, socket) => {
  socket.end();
  if (res.statusCode === 200) {
    console.log("✅ CONNECT 성공 — 프록시가 토스 API 목적지로 터널을 열었다.");
    process.exit(0);
  }
  console.error(`🔴 예상과 다른 응답: HTTP ${res.statusCode}`);
  process.exit(1);
});

req.on("timeout", () => {
  console.error("🔴 타임아웃 — 프록시에 연결할 수 없다. Fly 앱이 떠 있는지, 포트가 맞는지 확인하라.");
  req.destroy();
  process.exit(1);
});

req.on("error", (err) => {
  console.error("🔴 연결 오류:", err.message);
  process.exit(1);
});

req.end();
