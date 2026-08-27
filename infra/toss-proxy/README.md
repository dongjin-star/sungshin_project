# toss-proxy — Vercel 배포용 고정 IP 프록시

## 왜 필요한가

토스증권 Open API는 WTS에 등록한 허용 IP 외의 호출을 403(`ip-not-allowed`)으로 막는다.
Vercel 서버리스 함수는 요청마다 아웃바운드 IP가 바뀌므로, 앱을 Vercel에 그대로 두려면
**고정 IP를 가진 작은 중계 서버**를 하나 두고 토스로 나가는 요청만 그리로 우회시켜야
한다 (`POSTURE-PRD.md` §0.3 P-02, §10.3).

이 폴더가 그 중계 서버다. Node 내장 모듈만 쓰는 HTTP CONNECT 프록시 하나이며,
`openapi.tossinvest.com` 으로만 터널을 열어주고 그 외 목적지는 전부 거절한다. 인증
정보(Basic Auth) 없이는 뜨지도 않는다. 실제 토스 client_secret·access_token은 이
프록시를 지나가지 않는다 — CONNECT 터널을 연 뒤로는 Vercel 쪽 Node 프로세스와 토스
서버가 직접 TLS를 맺고, 프록시는 그 위의 암호화된 바이트를 그대로 흘려보낼 뿐이다.

**이 설계는 이미 검증했다.** 로컬에서 프록시를 띄우고 실제 토스 API로 토큰 발급과
시세 조회를 왕복시켜 성공을 확인했다(`src/lib/toss/core.ts` 의 `TOSS_PROXY_URL` 분기와
짝을 이룬다). 아래 절차에서 확인되지 않은 것은 **Fly.io 배포 자체의 정확한 명령·문법**
뿐이다 — `flyctl` 버전에 따라 조금씩 달라질 수 있으니, 각 단계 뒤에 있는 확인 방법으로
직접 검증하면서 진행한다.

## 필요한 것

- Fly.io 계정 (무료 가입, 카드 등록 필요 — dedicated IPv4가 유료다. 월 2달러 내외)
- `flyctl` CLI (`fly.io/docs/flyctl/install/`)
- 토스증권 WTS 접근 권한 (이미 갖고 계신 것)
- Vercel 프로젝트에 환경변수를 추가할 권한 (이미 갖고 계신 것)

여기서부터는 계정 생성·결제·로그인이 필요해 제가 대신 실행할 수 없다. 터미널에
`!` 를 붙여 직접 실행하시면 됩니다 (예: `! flyctl auth login`).

## 절차

### 1. Fly.io 로그인 및 앱 생성

```
flyctl auth login
```

`infra/toss-proxy` 안에서:

```
flyctl apps create <전역에서 유일한 이름>          # 예: posture-toss-proxy-<본인이름>
```

`fly.toml` 의 `app = "changeme-toss-proxy"` 를 방금 만든 이름으로 바꾼다.

### 2. 프록시 인증 정보 생성

이 프록시 자체를 지킬 사용자명·비밀번호다. 토스 자격증명과는 별개이며, 이 값이
새면 "이 프록시를 거쳐 토스 API를 호출할 수 있다"는 것만 새는 것이다 — 그래도
가볍게 볼 값은 아니니 무작위로 만든다.

```
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

두 번 실행해 `PROXY_USER`, `PROXY_PASS` 로 각각 쓴다.

```
flyctl secrets set PROXY_USER=<위에서 만든 값1> PROXY_PASS=<위에서 만든 값2>
```

### 3. 배포

```
flyctl deploy
```

배포 로그에 `toss-proxy 대기 중 :8080 — 허용 목적지: openapi.tossinvest.com` 이
보이면 컨테이너 자체는 정상이다.

### 4. 고정 IPv4 확보

```
flyctl ips allocate-v4 --dedicated
flyctl ips list
```

`--dedicated` 플래그명은 flyctl 버전에 따라 다를 수 있다. 안 먹으면 `flyctl ips
allocate-v4 --help` 로 확인하거나 Fly 대시보드의 "IP Addresses" 메뉴에서 직접
할당한다. **여기서 나온 IPv4 주소가 토스 WTS에 등록할 값이다.**

### 5. 연결 확인 (Vercel에 연결하기 전에 먼저)

프로젝트 의존성 없이 도는 독립 스크립트다:

```
node infra/toss-proxy/test-connectivity.js http://<PROXY_USER>:<PROXY_PASS>@<앱이름>.fly.dev:8080
```

`✅ CONNECT 성공` 이 나와야 한다. 여기서 막히면 Vercel에 연결해도 똑같이 막힌다 —
Fly 배포·시크릿·포트를 먼저 의심한다. `407` 이 나오면 시크릿 값이 안 맞는 것이고,
타임아웃이면 포트나 앱 이름을 다시 확인한다.

### 6. 토스 WTS에 IP 등록

WTS > 설정 > Open API > IP 관리에서 4단계의 dedicated IPv4를 추가한다. 기존에 등록해
둔 개발 머신 IP는 그대로 둬도 된다 — 여러 개를 등록할 수 있다.

### 7. Vercel에 연결

Vercel 프로젝트 > Settings > Environment Variables 에 추가:

```
TOSS_PROXY_URL = http://<PROXY_USER>:<PROXY_PASS>@<앱이름>.fly.dev:8080
```

Production(및 필요하면 Preview) 환경에 넣고 재배포한다. `src/lib/toss/core.ts` 가 이
값이 있으면 자동으로 프록시를 거치고, 없으면(로컬 개발) 지금까지처럼 직접 호출한다 —
코드를 더 바꿀 것은 없다.

### 8. 최종 확인

배포된 Vercel 사이트에서 종목 상세(`/stock/005930`)를 열어 가격이 뜨는지 확인한다.
막히면 Vercel 함수 로그에서 `[quotes]` 또는 `CONFIG_ERROR` 로그를 먼저 본다 —
`src/lib/service/quotes.ts` 와 `src/lib/api/respond.ts` 가 403을 조용히 삼키지 않고
로그에 남기도록 이미 되어 있다.

## 운영 메모

- 이 프록시는 딱 한 목적지(`openapi.tossinvest.com`)만 중계한다. `ALLOWED_HOSTS`
  시크릿/환경변수로 바꿀 수 있지만 넓힐 이유가 없다.
- Fly 앱을 재생성하면 IP가 바뀐다. 그러면 6·7단계를 다시 해야 한다.
- 비용은 dedicated IPv4(월 약 2달러) + Fly 앱의 최소 실행 비용이다. 트래픽이 적으면
  free allowance 안에서 거의 끝난다.
