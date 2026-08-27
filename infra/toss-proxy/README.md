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

**이 절차는 실제 배포·실제 장애·실제 수정을 거쳐 검증됐다** (2026-08-28,
`posture-toss-proxy` 앱). 처음 배포했을 때 두 가지를 잘못 알고 있었다 — 아래
절차는 그 실수를 반영해 고친 최종 버전이다. 배경은 `POSTURE-PRD.md` §10.3-a~e 에
전부 남아 있다.

> ⚠️ **가장 중요한 사실 하나.** Fly.io 에서 "IP" 는 **인바운드(ingress)** 와
> **아웃바운드(egress)** 가 완전히 별개의 자원이다. `flyctl ips allocate-v4` 로
> 받는 dedicated IPv4 는 **인바운드 전용**이다 — Vercel 이 이 프록시로 *들어올 때*
> 쓰는 주소이지, 프록시가 토스로 *나갈 때* 쓰는 주소가 아니다. **토스 WTS 에
> 등록해야 하는 IP 는 egress IP 하나뿐이다.** 처음 배포했을 때 이걸 몰라서
> ingress IP 를 등록해 놓고 왜 계속 403 이 나는지 한참 헤맸다.

## 필요한 것

- Fly.io 계정 (무료 가입, 카드 등록 필요)
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

카드 등록 직후라면 이미지 푸시 단계에서 `401`/`403` 이 한 번 날 수 있다 — Fly
빌드 서버 쪽 권한 전파 지연으로 보이며, **그냥 `flyctl deploy` 를 한 번 더
실행하면 된다.**

### 4. 인바운드 IP 확인 (등록 대상 아님)

새 앱을 만들면 Fly 가 인바운드용 IP 를 자동으로 붙여주지 않는 경우가 있다 —
`flyctl ips list` 로 아무것도 없으면 아래로 만들어 둔다:

```
flyctl ips allocate-v4
```

**이 IP 는 raw TCP 서비스(이 프록시가 그렇다)에 반드시 dedicated 여야 한다.**
비용을 아끼려고 `--shared` 로 받으면 안 된다 — 이유: Fly 의 shared IP 는 여러 앱이
한 주소를 나눠 쓰며 TLS SNI/HTTP Host 헤더로 목적지 앱을 구분하는데, 순수 TCP
CONNECT 프록시는 그런 헤더 자체가 없다. Fly 엣지가 연결을 받고도 어디로 돌려야
할지 몰라 그대로 리셋한다(`ECONNRESET`) — 실제로 겪은 장애다.

이 IP 는 **토스에 등록하지 않는다.** Vercel 은 IP 가 아니라 `<앱이름>.fly.dev`
호스트명으로 접속하므로 신경 쓸 일이 없다 — 그냥 "떠 있는지"만 확인하면 된다.

### 5. 아웃바운드(egress) IP 확보 — 토스에 등록할 값은 이거다

```
flyctl ips allocate-egress -a <앱이름> -r <배포 리전, 예: nrt>
```

리전은 `fly.toml` 의 `primary_region` 과 같아야 한다. 결과로 나오는 IPv4 가
**토스 WTS 에 등록할 IP** 다. 새로 만든 머신에 적용되기까지 5~10분 걸릴 수 있다.

### 6. 연결 확인 (Vercel에 연결하기 전에 먼저)

프로젝트 의존성 없이 도는 독립 스크립트다:

```
node infra/toss-proxy/test-connectivity.js http://<PROXY_USER>:<PROXY_PASS>@<앱이름>.fly.dev:8080
```

`✅ CONNECT 성공` 이 나와야 한다. 여기서 막히면 Vercel에 연결해도 똑같이 막힌다.

- `407` → 시크릿 값(PROXY_USER/PROXY_PASS)이 안 맞는다
- `ENOTFOUND`/타임아웃 → 앱 이름이 틀렸거나 인바운드 IP 가 없다 (4단계)
- `ECONNRESET` → 인바운드 IP 가 **shared** 다 — dedicated 로 다시 받는다 (4단계 경고 참고)

이 스크립트는 CONNECT 터널이 열리는지만 확인한다. 실제 토스 응답까지 왕복
확인하려면 가장 확실한 방법은 8단계까지 마치고 Vercel 배포본에서 직접 확인하는
것이다 — `/api/stock/005930` 이 실제 가격을 돌려주면 전 구간이 통과한 것이다.

### 7. 토스 WTS에 IP 등록

WTS > 설정 > Open API > IP 관리에서 **5단계의 egress IP**를 추가한다. 4단계의
인바운드 IP 는 등록하지 않는다 — 등록해도 토스가 보는 발신 IP 와 다르므로 아무
효과가 없다. 기존에 등록해 둔 개발 머신 IP 는 그대로 둬도 된다.

### 8. Vercel에 연결

Vercel 프로젝트 > Settings > Environment Variables 에 추가:

```
TOSS_PROXY_URL = http://<PROXY_USER>:<PROXY_PASS>@<앱이름>.fly.dev:8080
```

Production(및 필요하면 Preview) 환경에 넣고 재배포한다. `src/lib/toss/core.ts` 가 이
값이 있으면 자동으로 프록시를 거치고, 없으면(로컬 개발) 지금까지처럼 직접 호출한다 —
코드를 더 바꿀 것은 없다.

### 9. 최종 확인

배포된 Vercel 사이트에서 종목 상세(`/stock/005930`)를 열어 가격이 뜨는지 확인한다.
막히면 Vercel 함수 로그에서 `[quotes]`·`[db]`·`CONFIG_ERROR` 로그를 먼저 본다 —
원인을 조용히 삼키지 않도록 이미 로깅돼 있다. `🔴` 로 시작하는 줄이 실제 원인이다.

## 운영 메모

- 이 프록시는 딱 한 목적지(`openapi.tossinvest.com`)만 중계한다. `ALLOWED_HOSTS`
  시크릿/환경변수로 바꿀 수 있지만 넓힐 이유가 없다.
- **인바운드 IP 는 dedicated 여야 한다 (shared 불가 — raw TCP 라서).** 아웃바운드
  IP 는 별도로 `allocate-egress` 해야 하고, 그게 토스에 등록할 값이다. 이 둘을
  헷갈리면 몇 시간을 태운다 — 실제로 그랬다.
- Fly 앱을 재생성하면 인바운드·아웃바운드 IP 가 둘 다 바뀐다. 그러면 4~5·7·8
  단계를 다시 해야 한다.
- `fly.toml` 에 `auto_stop_machines = "stop"` 이 켜져 있다 — 유휴 시 VM이 자동으로
  멈추고 요청이 오면 다시 뜬다. IP 종류(shared vs dedicated) 문제와는 무관하다는
  것을 상시 가동으로 바꿔서도 확인했다 — 켜둔 채로 있는 것보다 훨씬 싸게 유지된다.
- Fly.io는 2024년부터 영구 무료 티어가 없다(신규 계정 $5 크레딧만 제공). 실측 비용은
  dedicated 인바운드 IPv4 월 $2 + egress IPv4 월 $3.60(리전당) 이 사실상 전부이고,
  VM은 auto-stop 덕에 정지 중엔 디스크 보관비(초경량 이미지라 무시할 수준)만 나간다.
