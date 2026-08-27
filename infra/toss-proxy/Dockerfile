# server.js 는 Node 내장 모듈(http, net, url)만 쓴다. 설치할 의존성이
# 없어서 이미지가 그만큼 작고, 공급망 위험도 없다.
FROM node:20-alpine

WORKDIR /app
COPY server.js ./

EXPOSE 8080
CMD ["node", "server.js"]
