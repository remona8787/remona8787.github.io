# 빛의 건축 v0.16 — 현재 시스템 진단

- 진단일: 2026-10-18 (UTC 11:42 시작)
- 대상: 브랜치 `claude/light-architecture-launch-ohxxxi`, 커밋 `d720028` (package.json `0.15.0`, 화면 표기 `빛의 건축 v0.15.0`)
- 범위: 메인 체크아웃의 현재 소스, 문서, 테스트, 설정. 병렬 v0.16 작업(`wt/arch-db`, `wt/arch-collect`, `wt/arch-admin`, `wt/arch-client`)은 보지도 고치지도 않았다.
- 원칙: 코드·설정·로그·실행 결과로 확인한 것만 적는다. 이 환경에서 확인할 수 없는 것은 "확인 불가"라고 적는다.
- 이 진단에서 고친 소스는 없다. 이 파일만 추가했다.

---

## 0. 진단 환경과 제약

이 컨테이너의 외부 접속은 npm 레지스트리 외에는 막혀 있다. 그래서 실제 서비스는 하나도 직접 확인하지 못했다.

| 대상 | 시도 | 결과 (원문) |
|---|---|---|
| 배포 주소 `https://light-architecture-jihyun.peppydegu2.chatgpt.site/` | `curl -sS` | `curl: (56) CONNECT tunnel failed, response 403` (프록시가 터널 거부) |
| 같은 주소 `/config.js` | `curl -sS` | 같은 오류 |
| 같은 주소 | WebFetch | `getaddrinfo ENOTFOUND light-architecture-jihyun.peppydegu2.chatgpt.site` |
| 대조군 `https://example.com/` | WebFetch | `getaddrinfo ENOTFOUND example.com`. 시험한 세 호스트(배포 주소, `peppydegu2.chatgpt.site`, `example.com`) 모두 WebFetch가 이름을 풀지 못했다. 배포 주소가 사라졌다는 증거가 아니다. |
| 보관본 `web.archive.org/...chatgpt.site/` | `curl` | `CONNECT tunnel failed, response 403` |
| Supabase `refwrdfxbhcsguweicle.supabase.co/auth/v1/settings` | `curl` | `CONNECT tunnel failed, response 403` |
| 같은 주소 | Node fetch (`NODE_USE_ENV_PROXY=1`) | `TypeError fetch failed`, cause `Request was cancelled.` |
| 같은 주소 | Node fetch (프록시 변수 미사용) | `ENOTFOUND getaddrinfo ENOTFOUND refwrdfxbhcsguweicle.supabase.co` |
| `query.wikidata.org`, `www.wikidata.org`, `commons.wikimedia.org`, `upload.wikimedia.org` | `curl` | 모두 `CONNECT tunnel failed, response 403` |
| `api.gdeltproject.org`, `www.dezeen.com/feed/`, `openapi.naver.com`, `api.search.brave.com`, `tile.openstreetmap.org`, `chatgpt.site`, `help.openai.com` | `curl` | 모두 `CONNECT tunnel failed, response 403` |
| `github.com` / `api.github.com` | `curl` | 터널 200. `github.com/`은 400 `{"message":"Request path could not be canonicalized."...}`, API는 200 |
| `claude.ai` | `curl -D-` | 터널 200, 응답 `HTTP/2 403`, `cf-mitigated: challenge`, `server: cloudflare`, 본문 `<title>Just a moment...</title>` |
| `registry.npmjs.org/leaflet` | `curl` | 200 |

프록시 상태(`curl -sS "$HTTPS_PROXY/__agentproxy/status"`, 2026-10-18T11:43:36Z): `"enabled": true`, `recentRelayFailures` 20건이 모두 `"kind": "connect_rejected"`, `"detail": "gateway answered 403 to CONNECT (policy denial or upstream failure)"`. 호스트는 `thumb.wikimedia.org:443` 10건과 `upload.wikimedia.org:443` 10건이다. 이 실패들은 E2E 테스트 중 앱이 사진을 불러오려다 생겼다.

따라서 아래에서 "실환경"이 붙은 항목(실제 Supabase, 실제 배포본, 실제 Wikidata·Commons 응답, 실제 수집원)은 모두 **미검증**이다.

---

## 1. 실행한 검증과 결과

모두 `light-architecture/`에서 실행했다.

| 명령 | 결과 |
|---|---|
| `npm test` | **310개 통과, 0 실패**, 16.1초 (단위, PGlite 위 SQL/RLS, 동기화 로직, 색 대비) |
| `npm run build` | exit 0. `Built static app from site-public-cleared → dist`, `Inlined 33889 byte icon sprite into 1 page(s)`, `Service worker cache aol-1f200acb3ed7` |
| `npm run check` | exit 0. `Syntax checked 11 scripts; local entry assets, auth guards, admin consistency passed.` / `All Edge Function TypeScript syntax checked (not server execution).` |
| `AOL_TEST_PORT=4173 npx playwright test --workers=2` | **146개 중 143개 통과, 3개 skip, 0 실패** (1분 48초). 통과: a11y 44, crawl 46, flows 10, global-places 17, global-places-server 5, legal 10, live-media 4, ux 7. skip 3개는 실제 외부 접속이 필요한 테스트다: `live-media.spec.mjs:108`, `global-places.spec.mjs:362` (`query.wikidata.org unreachable from this runner`), `ux.spec.mjs:14` (`upload.wikimedia.org unreachable`) |
| `npm run launch:check` (배포용 `site-public-cleared/config.js`) | exit 1. `operator_contact: passed`. 나머지 6개(`public_catalog`, `cleared_media_view`, `actual_media_available`, `editorial_articles`, `discovered_places_view`, `email_auth_enabled`)는 모두 `"status": "blocked", "reason": "backend_not_configured"` |
| `NODE_USE_ENV_PROXY=1 node scripts/launch-check.mjs release/launch/public-config.js` | exit 1. 6개 모두 `"status": "failed", "reason": "TypeError"` (위 표의 프록시 거부) |
| `deno check --no-config edge-functions/*/index.ts` (Deno 2.5.4) | 함수 13개 모두 `Check` 통과, 타입 오류 0. 캐시 없이 다시 돌려도 같고(1.3초), 일부러 넣은 타입 오류(TS2322)는 실패해 검사가 실제로 동작함을 확인 |
| `deno test --no-config --allow-env --allow-read tests/deno/` | **10개 통과**, 0 실패 (sync-global-places를 외부 요청 전부 흉내 낸 상태로 실행) |
| `git push --dry-run origin HEAD:claude/light-architecture-launch-ohxxxi` | exit 128. 원문: `remote: Claude doesn't have GitHub access to ymin02/medieval_era_project for your organization. An org admin can install the Claude GitHub App at https://github.com/apps/claude/installations/select_target, or reconnect GitHub from claude.ai settings (https://claude.ai/customize/connectors?auth_start=github&auth_start_force=1) to re-link an existing installation` / `fatal: unable to access 'https://github.com/ymin02/medieval_era_project/': The requested URL returned error: 403` |
| `git ls-remote origin` | 읽기는 된다. 원격 브랜치는 `refs/heads/main` (`f37dd49`) 하나뿐 |
| `git rev-list --count origin/main..HEAD` | **27** (원격에 없는 로컬 커밋 수) |
| 화면 캡처 | 주요 화면 29개 × 390×844·1440×900 = 58장(+390 첫 화면 29장, 보조 캡처 7장). `qa/fixtures.mjs`와 같은 방식으로 Wikidata·Commons API는 차단(`blockedbyclient`)하고 서비스워커는 막았다. Wikidata 상세·동기화 화면은 `tests/fixtures/global-places-fixtures.mjs` 녹화 응답을 썼다. |

참고: `scripts/launch-check.mjs:26`은 실행할 때마다 추적 중인 `release/launch/connectivity-report.json`을 덮어쓴다. 이번 실행 뒤 원래 내용(2026-10-11 기록)으로 되돌렸다.

---

## 2. (a) 기능별 상태 요약

상태 구분: 정상 작동·검증 완료 / 구현 완료·실환경 검증 필요 / 디자인만·미연결 / 미완료 / 외부 설정 필요.
"검증 완료"는 로컬 빌드(`dist/`)와 운영 CSP를 적용한 로컬 서버 기준이다. 배포본에서 확인한 것은 하나도 없다.

| 기능 | 현재 상태 | 근거 |
|---|---|---|
| 화면 구성과 이동 (홈·발견·지도·상세·저장·코스·기록·일정·마이·설정·계정·정적 페이지·404) | 정상 작동·검증 완료 | crawl 46개 통과(오류·가로 넘침·24px 미만 터치 영역 없음), 캡처 58장 모두 가로 넘침 0 |
| 검색·필터·정렬 (범위, 국가, 도시, 일정 상태, 콘텐츠 구분, 연도, 무료, 실내) | 정상 작동·검증 완료 | `tests/catalog.test.cjs`, `qa/global-places.spec.mjs` "explore: country and city filters…" 통과 |
| 비회원 기기 저장 (저장·코스·방문 기록·메모) | 정상 작동·검증 완료 | `tests/app.test.cjs`, `qa/flows.spec.mjs` "visit record survives reload" 통과 |
| JSON 백업·복원, CSV·ICS 내보내기 | 정상 작동·검증 완료 | `tests/core.test.cjs` 백업·CSV·ICS 테스트, flows "JSON backup downloads" 통과 |
| 테마(시스템·라이트·다크), 오프라인 셸, PWA | 정상 작동·검증 완료 | flows "theme toggle persists", "app shell loads offline after first visit" 통과 |
| 접근성 (axe WCAG 2.1 A/AA, 라이트·다크) | 정상 작동·검증 완료 | a11y 44개 통과 |
| 법적 고지·운영자 정보 (소스 기준) | 정상 작동·검증 완료 | launch-check `operator_contact: passed`, legal 10개 통과. 배포본(v0.13.3)은 운영자 정보가 빈 버전(P05) |
| 수록 장소 49곳 표시 | 정상 작동·검증 완료 | `site-public-cleared/assets/seed.js` 49곳, 화면 "전체 · 49곳" |
| 수록 장소 정보의 최신성 | 미완료 | 49곳 모두 `verified_at` 2026-09-22, 앱 자체 판정 "재확인 시점 경과 19곳", 프로그램 종료 6곳 (P07) |
| 지도 — 수록 장소 핀 | 미완료 | 수록 49곳 좌표 0곳 (`latitude` null 49/49), 지도 "전체 · 0곳" (P07, U11) |
| 지도 — Wikidata 좌표 원형 표시 | 구현 완료·실환경 검증 필요 | 녹화 응답으로 39곳 표시 확인(`mock-map-synced-*.png`). 실제 Wikidata 테스트 skip |
| 장소 사진 (검토된 2장 + 브라우저 6시간 Commons 동기화) | 구현 완료·실환경 검증 필요 | live-media 4개 통과(녹화 응답). "published project photos actually decode" skip, Wikimedia 이미지 호스트는 프록시 403 |
| 전국·세계 장소 브라우저 동기화 (Wikidata 갈래 12개) | 구현 완료·실환경 검증 필요 | global-places 17개 통과(녹화 응답). 실제 Wikidata 테스트 skip |
| 서버 동기화 `sync-global-places` + `public_discovered_places` | 외부 설정 필요 | 코드·SQL·Deno 10개 통과. SQL 미적용·함수 미배포·예약 미설치 (STATUS_v0.15.md:20-22) |
| Supabase DB·RLS | 외부 설정 필요 | 배포 설정 `config.js:2-3` 빈 값. 운영 프로젝트는 부분 적용 상태(STATE.md). PGlite에서만 검증 |
| 로그인·회원가입·비밀번호 재설정 | 외부 설정 필요 | 코드 있음(`client/cloud.js`). 설정이 비어 계정 화면은 "여러 기기 동기화는 준비 중이에요"만 표시(`account-390.png`) |
| 기기 간 동기화 (CAS·Realtime) | 외부 설정 필요 | `tests/cloud.test.cjs`, SQL 두 사용자 격리 테스트 통과. 실서버 미실행 |
| 방문 사진 비공개 업로드·조회·삭제 | 외부 설정 필요 | `client/private-photos.js`, `app.js:263`. 로그인 전에는 "개인 사진은 로그인하고 서버에 연결한 뒤 쓸 수 있어요." 실제 Storage 업로드 미실행(STATE.md:27) |
| 계정 삭제 (`delete-account` 함수) | 외부 설정 필요 | 함수 코드·타입 검사 통과. 미배포 |
| 인증 메일 발송 (SMTP·리디렉트) | 외부 설정 필요 | LAUNCH.md 5단계 미완료 |
| 매거진 (`archive_articles`) | 디자인만·미연결 | 화면은 "아직 등록된 글이 없어요"(`magazine-390.png`). 테이블은 운영 DB에 없음(2026-10-11 `editorial_articles` 404) |
| 관리자 콘솔 (후보 검토·승격·글 작성) | 디자인만·미연결 | `admin/config.js` 빈 값, 로그인 버튼 비활성, 개발자용 안내 노출(`admin-390.png`) |
| 관리자 사진 검토 (이름 검색으로 찾은 사진 승인) | 미완료 | `sync-place-media`가 검토 대기로 넣지만 승인 UI 없음 (P12) |
| 자동 수집 함수 (discover-city-candidates, sync-place-media, refresh-media-rights, cache-commons-media) | 외부 설정 필요 | 타입 검사 통과, 미배포, 실행 기록 없음 |
| 공공데이터·행사 커넥터 (sync-seoul-cultural-events, sync-korea-open-data, sync-ticketmaster, sync-wikidata, refresh-live-place) | 디자인만·미연결 | 4개는 501 스텁, sync-seoul-cultural-events는 받아서 버림 (P14) |
| 뉴스·검색엔진·RSS 자동 수집 (GDELT·RSS·WebSub·Naver·Brave) | 미완료 | 메인 소스에 없음. v0.16 collector 트랙 (P08) |
| 미디어파사드 아카이브 DB | 미완료 | v0.16 db 트랙 (P09) |
| 아카이브 검토 콘솔 | 미완료 | v0.16 admin 트랙 (P10) |
| 아카이브 탐색 UI (유형·기술·외피 필터, 지도, 상세, KO/EN, 연구용 내보내기) | 미완료 | v0.16 client 트랙 (P11) |
| 보안 헤더·CSP | 구현 완료·실환경 검증 필요 | `_headers:1-10` 로컬 서버에서 적용·E2E 통과. 배포 호스트가 `_headers`를 따르는지 확인 불가 (P15) |
| 배포 (공개 주소) | 외부 설정 필요 | 문서상 v0.13.3. 확인 불가 (P05) |
| GitHub 반영·CI·Pages | 외부 설정 필요 | push 403, 로컬 커밋 27개 미반영 (P06) |
| Android·iOS 빌드 | 미완료 | 이번에 실행하지 않음. 마지막 기록은 Gradle 다운로드 차단으로 실패(STATUS_v0.12.md:18) |

---

## 3. (b) 운영자 질문 10개에 대한 답

### 1. 현재 정상 작동하는 기능과 실제로 작동하지 않는 기능은 무엇인가?

**정상 작동 (로컬 빌드에서 검증):** 모든 화면 표시와 이동, 수록 49곳 검색·필터·정렬, 저장·코스·방문 기록, JSON 백업·복원, CSV·ICS 내보내기, 테마, 오프라인 셸, 법적 페이지 운영자 표시, 접근성. 근거는 단위 310개와 브라우저 143개 통과다.

**작동하지 않음 (현재 배포 설정 기준):**
- 로그인·회원가입·비밀번호 재설정, 기기 간 동기화, 방문 사진 업로드, 계정 삭제. `site-public-cleared/config.js:2-3`의 `SUPABASE_URL`·`SUPABASE_PUBLISHABLE_KEY`가 빈 문자열이라 클라이언트가 서버를 만들지 않는다(`client/cloud.js:4`, `:44`).
- 매거진, 관리자 콘솔, 서버 동기화, 모든 서버 수집 함수.
- 지도의 수록 장소 핀: 좌표가 있는 수록 장소가 0곳이다.
- 501 스텁 함수 4개.

**작동 여부를 알 수 없음:** 실제 Wikidata·Commons에서 장소와 사진을 받아오는 브라우저 동기화. 녹화 응답으로는 통과하지만 실제 접속 테스트 3개가 skip됐다.

### 2. 디자인만 구현되어 있고 실제 데이터 또는 서버와 연결되지 않은 기능은 무엇인가?

- **계정 관련 화면 요소:** 마이 화면 "로그인" 버튼(`app.js:234`)과 저장 화면 "동기화 상태" 버튼(`app.js:79`)은 서버가 없어도 보인다. 누르면 "준비 중" 안내로 간다.
- **매거진:** 화면만 있고 글이 없다. 글을 읽을 `archive_articles` 테이블이 운영 DB에 없다.
- **관리자 콘솔:** `admin/config.js`가 비어 있어 로그인할 수 없다. 기능도 v0.10 시절의 "서울·도쿄·뉴욕 후보" 검토와 글 작성뿐이다.
- **행사·공공데이터 커넥터:** `refresh-live-place`, `sync-korea-open-data`, `sync-ticketmaster`, `sync-wikidata`는 501을 돌려주는 스텁이다. `sync-seoul-cultural-events`는 배포 목록(`scripts/deploy-edge-functions.sh:14`)에 있지만 받은 행 수만 세고 저장하지 않는다.
- **장소 제보:** 반대 경우다. 서버 API(`client/cloud.js:98` `submit`)와 테이블은 있지만 이를 부르는 화면이 없다(`app.js`·`account.js`에서 호출 0건).
- **로그인·동기화·방문 사진·계정 삭제:** 코드와 테스트는 있지만 서버 설정이 없어 사용자에게는 연결되지 않은 상태다.

### 3. 데이터베이스와 외부 API 연결은 정상인가?

**아니다. 그리고 이 환경에서는 확인할 수 없다.**
- **배포 설정:** 서버 주소가 비어 있다. `launch:check` 결과 6개 항목이 `backend_not_configured`다.
- **운영 Supabase 프로젝트** (`refwrdfxbhcsguweicle`): `release/launch/STATE.md`에 따르면 일부만 적용됐다. 남은 SQL을 묶은 `complete-backend.sql`은 MCP 오류(`-32602 Invalid or expired requestState`)로 실행되지 않았다(STATE.md:15-19).
- **마지막 실제 접속 기록** (`release/launch/connectivity-report.json`, 2026-10-11):
  - `public_catalog` 400, `editorial_articles` 404, `actual_media_available` failed. `cleared_media_view` 200, `email_auth_enabled` passed.
  - 400의 원인: 앱이 묻는 `places → cities` 관계(`places.city_id`)가 `complete-backend.sql:909`에서야 생긴다.
  - 404의 원인: `archive_articles`가 `complete-backend.sql:970`에서야 생긴다.
  - 두 원인 모두 SQL이 실행되지 않은 것과 맞는다.
- **오늘 접속 시도:** 프록시 403으로 막혀 현재 상태는 확인 불가다.
- **외부 API (Wikidata·Commons):** 방문자의 브라우저가 직접 부르는 구조다. 이 환경에서는 실제 응답을 한 번도 받지 못했다(skip 3개).

### 4. 미디어파사드 데이터는 실제 수집되고 있는가, 아니면 정적·임시 데이터인가?

**정적 데이터다.**
- **수록 장소:** 서울 49곳(`assets/seed.js`, VERSION.json `"data_provenance": "uploaded v0.10; not reverified"`).
  - 49곳 모두 `verified_at`이 2026-09-22이고, 좌표가 있는 곳은 0곳이다(`geocode_status` needs_geocoding 46, needs_manual_review 3).
  - 오늘(2026-10-18) 기준 `program_end`가 지난 곳이 6곳이다(SEOUL006, SEOUL011–015).
  - 서버 시드도 같은 50행(게시 49, 좌표 0)이다. 부분 적용 상태 위에 `complete-backend.sql`을 PGlite로 적용해 확인했다.
- **서버 수집:** 한 번도 돌지 않았다. 함수 미배포, 예약 미설치이고, STATUS_v0.13.3.md:30에 "현재 예약 실행 증거 없음"이라고 적혀 있다. 2026-10-10 수동 시도(`DISCOVERY_ATTEMPT_v0.13.1.json`)는 서울·도쿄·뉴욕 후보 0개였고, 진단 쿼리는 HTTP 403이었으며, DB에 저장되지 않았다(`"databaseConnected": false`).
- **유일한 자동 갱신:** 방문자 브라우저의 Wikidata 구조화 데이터 동기화(v0.14.1·v0.15, 6시간)다. 배포본(v0.13.3)에는 이 기능이 없고, 최신 소스에서도 실제 Wikidata로 돌려본 적이 없다.

### 5. 검색엔진 또는 외부 사이트의 새로운 정보가 자동으로 반영되고 있는가?

**아니다.**
- 메인 소스에는 뉴스·검색엔진·RSS 수집 코드가 없다(GDELT·RSS·WebSub·Naver·Brave 모두 v0.16 collector 트랙에서 작성 중).
- 서버 쪽 Wikidata·Overpass 후보 발굴 함수는 있지만 배포·예약되지 않았다.
- 서울 문화행사 함수는 저장하지 않는다(P14).
- 관리자 승인 경로(검토 콘솔)도 아직 없다(P10).
- 브라우저의 Wikidata 동기화는 구조화 데이터(QID·좌표·대표 사진)만 가져오며, 실제 동작은 미검증이다.

### 6. 이미지 업로드, 저장, 불러오기 및 사용자 인증 기능은 정상인가?

**코드와 로컬 테스트까지만 정상이고, 실제 서비스에서는 쓸 수 없다.**
- **인증:** 서버 설정이 비어 있어 비활성이다. SMTP와 리디렉트 주소도 설정되지 않았다(LAUNCH.md 5단계). 운영 프로젝트의 Auth 사용자는 0명이다(STATE.md:12).
- **방문 사진 업로드·저장·조회·삭제:** `client/private-photos.js`가 EXIF를 지우고 JPEG로 다시 저장한 뒤 비공개 버킷에 올리고, 60초 서명 링크로 연다. 단위 테스트(`tests/image-safety.test.cjs`)와 PGlite RLS 테스트("visit photos: metadata rows and storage objects are owner-only")는 통과한다. 실제 Storage 업로드는 한 번도 실행되지 않았다(STATE.md:27). 로그인이 안 되므로 사용자가 이 기능에 닿을 수 없다.
- **공개 장소 사진 불러오기:**
  - 검토된 사진 2장은 Wikimedia에서 직접 불러온다(`assets/reviewed-media.js`, `thumb.wikimedia.org` 960px).
  - `thumb.wikimedia.org`는 2026년 Wikimedia가 썸네일을 옮긴 실제 도메인이다(Phabricator T427465). 이 컨테이너에서는 프록시 403이라 화면에 "사진을 불러오지 못했어요"가 나오며, 이는 이 환경의 제약이다.
  - 실제 사진 디코드 테스트는 skip됐다.
  - 서버 Storage 캐시 사진은 0장이다(STATE.md:12).

### 7. 모바일과 데스크톱에서 발생하는 UI 오류는 무엇인가?

깨진 레이아웃은 없다. 캡처 58장 모두 가로 넘침이 0이고, 앱 오류도 없다(콘솔 오류는 일부러 막은 API 요청과 프록시가 막은 이미지뿐이다). 확인된 결함은 다음과 같고, 상세는 5장(d)에 있다.
- **데이터·내용에서 생기는 문제:**
  - "지금 볼 수 있는 빛의 공간" 레일 카드에 "재확인 시점 경과" 배지가 붙는다.
  - 지도에 수록 장소 핀이 0개다.
  - 사진 2장이 홈에서 5번 반복된다.
- **서버 미연결 상태의 혼란:** "로그인" 버튼, "동기화 상태" 버튼, "세계" 범위 실패 안내가 해당한다.
- **내부 용어 노출:** 설정 화면의 "실패한 검색" 원문, `refresh_days`.
- **44px보다 작은 터치 영역:** 카드 저장 36×36, 카드 "코스" 32px.
- **관리자 콘솔:** 비활성 버튼이 활성처럼 보인다.
- **표기 불일치:** 문서 제목 띄어쓰기, 모바일·데스크톱 지도 버튼 문구, 법적 페이지 버전 표기, 탭 활성 표시가 서로 맞지 않는다.

### 8. 이전 배포 과정에서 발생했던 HTTP 403 오류 및 접근 제한 문제는 해결되었는가?

종류별로 다르다. **해결된 것은 없다.** 다만 서비스 자체의 결함은 아니다.

| 403 종류 | 현재 상태 (2026-10-18) | 원인 | 해결 방법 |
|---|---|---|---|
| **GitHub push 403** | 미해결. `git push --dry-run` 결과 위 1장 원문 그대로. 읽기(`ls-remote`)는 된다. 원격에는 `main`(`f37dd49`)만 있고 이 브랜치와 로컬 커밋 27개가 없다. | 이 세션의 Claude GitHub App이 `ymin02/medieval_era_project`에 대한 쓰기 권한이 없음 | 운영자: https://claude.ai/connect-github 에서 GitHub를 다시 연결하고 저장소에 Claude GitHub App을 설치(또는 저장소 소유자에게 요청). 또는 운영자 PC에서 직접 push (P06) |
| **프록시·네트워크 정책 403** (`upload.wikimedia.org`, `thumb.wikimedia.org`, `query.wikidata.org`, `www.wikidata.org`, `commons.wikimedia.org`, `*.supabase.co`, 배포 주소, 수집원들) | 미해결. 모두 `CONNECT tunnel failed, response 403`, 프록시 상태 `connect_rejected`. | 이 개발 컨테이너의 외부 접속 정책. 실제 방문자에게는 해당 없음 | 컨테이너에서 실환경 검증을 하려면 운영자가 클라우드 환경 설정의 Network access → Allowed domains에 호스트 추가(https://code.claude.com/docs/en/cloud-environments#network-access). 또는 GitHub Actions나 운영자 PC에서 검증 (P16) |
| **claude.ai 403** | 지금도 403. 다만 터널은 열리고(`200 Connection Established`) claude.ai가 `HTTP/2 403`, `cf-mitigated: challenge`를 돌려준다. | Cloudflare의 봇 확인. 브라우저가 아닌 클라이언트는 통과 못함. 네트워크 정책이나 앱 결함이 아님 | 해당 없음. claude.ai 아티팩트로 미리보기를 보려면 `scripts/build-preview.mjs` 결과를 브라우저에서 열어야 하며, 이 환경에서는 확인 불가 |
| **이전 문서의 403** (STATUS_v0.12.md:12, STATUS_v0.13.md:27, STATUS_v0.13.3.md:19 "Commons 파일 다운로드 HTTP 403", DISCOVERY_ATTEMPT_v0.13.1.json:23 Wikidata 진단 쿼리 403) | 원인 미확정. 오늘도 같은 호스트가 이 컨테이너에서 403이므로 같은 접속 정책일 가능성이 높다. 다만 Wikimedia는 User-Agent가 없거나 일반적인 요청을 막거나 제한한다. 서버 함수 일부가 User-Agent 없이 Wikimedia를 부르므로 실서버에서도 같은 403이 날 수 있다(P13). | 개발 환경 접속 정책 + (가능성) Wikimedia User-Agent 정책 | P13 수정 후 실서버 첫 실행 응답과 `sync_runs`로 확인 |

### 9. 현재 배포된 서비스와 최신 소스코드 사이에 차이가 있는가?

**문서와 git 기록으로 보면 크게 다르다. 다만 배포본 자체는 이 환경에서 열 수 없어 직접 비교하지 못했다**(curl 프록시 403, WebFetch DNS 실패).
- **배포된 것으로 기록된 버전:** v0.13.3 (STATUS_v0.13.3.md, 2026-10-12). 그 뒤 배포 기록은 release 문서와 git 어디에도 없다.
- **v0.13.3 기준 커밋(`8098c4d`)과 비교:**
  - 메타데이터: 화면 `v0.13.3`, 서비스워커 캐시 `aol-v0133-20261012-1`, `config.js`의 `OPERATOR_NAME: ''`·`SUPPORT_EMAIL: ''`.
  - 따라서 배포본의 개인정보 처리방침 등은 운영자·연락처가 빈 상태("(운영자 등록 전)")일 가능성이 높다. 이는 개인정보 보호법이 요구하는 운영자·연락처 공개를 충족하지 못한다는 뜻이다.
- **현재 소스:**
  - 버전과 캐시: v0.15.0, 빌드 캐시 `aol-1f200acb3ed7`, 운영자 김지현·remona56@hanmail.net.
  - 기준 이후 바뀐 것: `light-architecture/` 커밋 24개, 175개 파일, +10,146/−527줄. 앱 소스(`site-public-cleared`·`client`)만 보면 46개 파일(추가 15, 삭제 3, 수정 28).
  - 기능 차이:
    - v0.14: 실제 브라우저 E2E, CSP 수정(Realtime `wss`), 정적 404, Leaflet 자체 호스팅, 서비스워커 캐시 이름 자동화.
    - v0.14.1: 운영자 정보, 사진·정보 6시간 동기화.
    - v0.15: 전국·세계 장소 동기화, 서버 동기화.
    - 화면 전면 재설계(Pretendard, Phosphor 아이콘), 로고 V2.
- **서버 쪽:** 배포본은 서버 설정이 빈 상태이고, 최신 소스도 같다. 둘 다 서버 기능은 꺼져 있다.

### 10. 실제 정식 런칭을 방해하는 가장 중요한 문제는 무엇인가? (우선순위 순)

1. **백엔드가 적용·연결되지 않음** (P01, P02, P03, P04): `complete-backend.sql` 미실행, 함수 미배포, 예약 미설치, SMTP 미설정, 관리자 미지정, 배포 설정 빈 값. 계정·동기화·사진·검토·서버 수집이 전부 꺼져 있다.
2. **공개 주소의 배포본이 오래됐고 확인할 수 없음** (P05, P15): v0.13.3, 운영자 정보 없음, 이후 27개 커밋 미배포. 배포 호스트도 정해지지 않았다(ChatGPT Sites 베타 / Netlify / Vercel / GitHub Pages 설정이 모두 있음).
3. **코드가 저장소에 없음** (P06): GitHub push 403. 로컬 커밋 27개가 이 컨테이너에만 있다. CI·Pages·v0.16 수집 점검 워크플로가 한 번도 돌 수 없다.
4. **아카이브의 핵심 기능이 아직 메인에 없음** (P08–P11): 자동 수집, 아카이브 DB, 검토 콘솔, 탐색 UI. v0.16 병렬 트랙에서 작성 중이다.
5. **수록 데이터가 정적이고 낡음** (P07): 서울 49곳만, 좌표 0곳, 사진 2장, 26일 전 확인, 종료 프로그램 6곳.
6. **실환경 검증이 전혀 없음** (P16): 실제 Supabase·Wikidata·Commons·배포본 확인이 이 환경에서는 불가능하다.
7. **사진 파이프라인의 빈틈** (P12, P13): 사진 승인 UI가 없고, 서버 함수 일부가 Wikimedia User-Agent를 보내지 않는다.

---

## 4. (c) 문제 목록

형식: 문제 증상 → 확인된 원인 → 영향 범위 → 해결 방법 → 실제 수정 결과 → 재검증 여부.
담당: v0.16 트랙 / 운영자 / 미지정.

### P01 · blocker · 백엔드(Supabase) · 운영자
- **문제 증상:** 배포 설정에 서버가 없다. `launch:check`(배포 설정) 6개 항목 `blocked: backend_not_configured`. 마지막 실접속(2026-10-11): `public_catalog` 400, `editorial_articles` 404, `actual_media_available` failed.
- **확인된 원인:**
  - `site-public-cleared/config.js:2-3` `SUPABASE_URL: ''`, `SUPABASE_PUBLISHABLE_KEY: ''`.
  - 운영 프로젝트는 부분 적용 상태에서 `complete-backend.sql` 일괄 실행이 MCP `-32602`로 실패했다(STATE.md:15-19).
  - 400은 `places.city_id`가 `complete-backend.sql:909`에서야 생기기 때문이다. 404는 `archive_articles`가 `:970`에서야 생기기 때문이다.
  - 부분 적용 상태 위에 `complete-backend.sql`을 적용하면 필요한 테이블이 모두 생기는 것은 PGlite로 확인했다(`npm test` "complete-backend.sql is idempotent on the reported partial state" 통과, 별도 확인에서 `place_submissions`·`user_workspaces`·`visit_photos`·`archive_articles`·`discovered_places`·`app_admins` 생성).
- **영향 범위:** 로그인, 기기 간 동기화, 방문 사진, 계정 삭제, 매거진, 관리자 콘솔, 서버 동기화, v0.16 아카이브 전체.
- **해결 방법:**
  1. Supabase SQL Editor에서 `release/launch/complete-backend.sql` 전체 실행(LAUNCH.md 4단계, 재실행 안전).
  2. v0.16 통합 뒤 추가되는 아카이브 마이그레이션도 같은 파일로 실행.
  3. `NODE_USE_ENV_PROXY=1 node scripts/launch-check.mjs release/launch/public-config.js`로 `public_catalog`·`editorial_articles`·`discovered_places_view` passed 확인.
  4. 5–8단계(P02–P04)를 마친 뒤 `public-config.js`의 두 값을 `site-public-cleared/config.js`에 복사하고 다시 빌드·배포(LAUNCH.md 9단계).
- **실제 수정 결과:** 외부 설정 필요 — 위 1–4.
- **재검증 여부:** 미실행. supabase.co가 프록시 403이라 이 환경에서 불가.

### P02 · blocker · 서버 함수·예약 · 운영자
- **문제 증상:** 서버 수집·사진 확인·전국·세계 동기화가 한 번도 실행되지 않았다.
- **확인된 원인:** Edge Functions 미배포, Vault 비밀값·예약 미설치(STATE.md:30, STATUS_v0.15.md:20-22, VERSION.json `"backend_status": "sql_verified_locally; not applied to production"`). 예약 SQL(`install-six-hour-sync.sql:19-26`)은 Vault 값과 `discovered_places`가 없으면 멈추도록 되어 있다.
- **영향 범위:** 자동 갱신 전부. 서버가 비어 있으면 앱은 방문자 브라우저마다 Wikidata를 조회한다(LAUNCH.md:162).
- **해결 방법:**
  1. `SUPABASE_ACCESS_TOKEN=sbp_... ./scripts/deploy-edge-functions.sh`(함수 9개, 비밀값 생성).
  2. Vault 비밀값 3개 생성.
  3. `release/launch/install-six-hour-sync.sql` 실행.
  4. LAUNCH.md 7단계의 수동 첫 실행(`{"phase":"places"}` → `{"phase":"images"}`).
  5. `sync_runs`·`cron.job_run_details` 확인.
- **실제 수정 결과:** 외부 설정 필요 — 위 1–5.
- **재검증 여부:** 미실행. 로컬에서는 Deno 타입 검사 13개, Deno 실행 테스트 10개 통과.

### P03 · blocker · 인증 메일 · 운영자
- **문제 증상:** 서버를 켜도 일반 사용자에게 가입 확인·비밀번호 재설정 메일이 가지 않는다.
- **확인된 원인:** Supabase 기본 메일은 프로젝트 팀원에게만 소량 발송한다(LAUNCH.md:88). SMTP와 Site URL·Redirect URL이 설정되지 않았다. 앱은 `PUBLIC_URL`을 리디렉트로 쓴다(`client/cloud.js:81`, `:83`).
- **영향 범위:** 회원가입, 비밀번호 재설정, 계정 기능 전체.
- **해결 방법:**
  1. Authentication → URL Configuration에 실제 공개 주소 입력.
  2. Emails → SMTP Settings에 외부 SMTP 연결.
  3. 팀원이 아닌 주소로 가입·재설정 시험.
  4. 배포 주소를 바꾸면(P15) `PUBLIC_URL`도 함께 수정.
- **실제 수정 결과:** 외부 설정 필요 — 위 1–4.
- **재검증 여부:** 미실행.

### P04 · blocker · 관리자 권한·설정 · 운영자
- **문제 증상:** 관리자 콘솔에 로그인할 수 없다(`admin-390.png`: "서버 미연결: config.js에 SUPABASE_URL / PUBLISHABLE_KEY를 입력하세요").
- **확인된 원인:**
  - `admin/config.js:2-3`, `site-public-cleared/admin/config.js:2-3` 빈 값. 콘솔은 앱과 별도의 설정 파일을 쓴다.
  - 운영 DB에 관리자 테이블이 없다(STATE.md:11).
  - 관리자 행(`app_admins`)은 운영자 본인이 가입한 뒤에만 넣을 수 있다.
- **영향 범위:** 후보 검토·승격, 글 작성, v0.16 아카이브 검토.
- **해결 방법:**
  1. P01 이후 사이트에서 운영자 계정 가입.
  2. LAUNCH.md 8단계 SQL로 `app_admins` 등록.
  3. 관리자 `config.js` 두 사본에도 URL·공개 키 입력 후 배포.
- **실제 수정 결과:** 외부 설정 필요 — 위 1–3.
- **재검증 여부:** 미실행.

### P05 · blocker · 배포본 · 운영자
- **문제 증상:** 공개 주소가 v0.13.3(2026-10-12)으로 기록되어 있다. 이후 배포 기록이 없고, 이 환경에서는 열어볼 수 없다.
- **확인된 원인:**
  - 이후 버전(v0.14–v0.15, 재설계, 로고 V2)은 배포하지 않았다.
  - v0.13.3 기준 커밋의 `config.js`는 `OPERATOR_NAME: ''`, `SUPPORT_EMAIL: ''`이다(`git show 8098c4d:light-architecture/site-public-cleared/config.js`).
- **영향 범위:**
  - 방문자는 옛 화면과 기능을 본다(전국·세계 장소, 사진 동기화, 운영자 정보 없음).
  - 법적 페이지에 운영자·연락처가 비어 있을 가능성이 높다(배포본 미확인).
- **해결 방법:**
  1. 배포 대상 결정(P15).
  2. `npm ci && npm test && npm run build`로 만든 `dist/` 배포.
  3. 배포 주소에서 `AOL_TEST_URL=<주소> npm run e2e`(LAUNCH.md 3단계) 실행. 이 실행에서 skip되던 실제 Wikidata·사진 테스트 3개도 돈다.
- **실제 수정 결과:** 외부 설정 필요 — 위 1–3.
- **재검증 여부:** 미실행. 배포 주소가 프록시 403, WebFetch는 DNS 실패.

### P06 · blocker · 소스 저장소 · 운영자
- **문제 증상:** `git push` 403. 원격에는 `main`(`f37dd49`, 3D 에셋 커밋)만 있다.
- **확인된 원인:** 이 세션의 Claude GitHub App이 저장소에 쓰기 권한이 없다(오류 원문 1장).
- **영향 범위:**
  - 로컬 커밋 27개(빛의 건축 v0.13.3–v0.16 명세 전부)가 이 컨테이너에만 있어 유실 위험이 있다.
  - `.github/workflows/light-architecture.yml`(CI), `light-architecture-pages.yml`(Pages), v0.16 collector의 수집 점검 워크플로가 한 번도 실행될 수 없다.
- **해결 방법:**
  - 운영자가 https://claude.ai/connect-github 에서 GitHub 재연결 + 저장소에 Claude GitHub App 설치(조직 저장소면 소유자에게 요청).
  - 또는 운영자 PC에서 이 브랜치를 받아 직접 push. 권한이 생기면 실제 push 후 CI 결과 확인.
- **실제 수정 결과:** 외부 설정 필요 — 위 조치.
- **재검증 여부:** `git push --dry-run` 2026-10-18T11:44:06Z 여전히 403.

### P07 · major · 수록 데이터 · 운영자(편집)
- **문제 증상:** 화면 곳곳에 "재확인 시점 경과" 배지가 붙고, 지도 수록 핀이 0개이며, 대부분 "사진 준비 중"이다.
- **확인된 원인:** `assets/seed.js`의 49곳은 v0.10 업로드 데이터다.
  - 모두 `verified_at` 2026-09-22, `latitude` null 49/49(`geocode_status` needs_geocoding 46, needs_manual_review 3).
  - `refresh_days` 7일 9곳·14일 17곳. 앱 설정 화면 "재확인 시점 경과 19곳".
  - `program_end` 경과 6곳(SEOUL006 2026-09-13, SEOUL011–015 2026-09-19).
  - 사진 2장(`assets/reviewed-media.js`).
- **영향 범위:** 홈·발견·지도·일정의 신뢰도. "지금 볼 수 있는" 레일 문제(U09)와 지도가 빈 문제(U11)의 원인이다.
- **해결 방법:**
  - 공식 출처로 49곳의 일정·운영 재확인.
  - 출처가 있는 좌표 입력(`coordinate_review_status='verified'` + 출처 URL. 추정 좌표 금지 원칙 유지).
  - 권리 확인된 사진 추가.
  - v0.16 관리자 콘솔(`archive_admin_upsert_project`)이 도구가 되지만 편집 작업 자체는 사람이 해야 한다.
- **실제 수정 결과:** 미착수 (편집 작업, 담당 미지정).
- **재검증 여부:** 해당 없음.

### P08 · blocker · 자동 수집 (뉴스·검색·RSS) · v0.16 collector 트랙
- **문제 증상:** 검색엔진·뉴스·외부 사이트의 새 정보가 반영되지 않는다.
- **확인된 원인:** 메인 소스에 수집 코드가 없다. 기존 발굴 함수는 미배포다. 2026-10-10 수동 시도 결과 후보 0개, 진단 쿼리 403, DB 미저장(`DISCOVERY_ATTEMPT_v0.13.1.json`).
- **영향 범위:** "계속 갱신되는 세계 미디어파사드 아카이브"라는 목표 전체.
- **해결 방법:** `docs/ARCHIVE_SPEC.md` 2·3·5장 (GDELT·RSS·WebSub·Naver·Brave 수집 → 후보 → 편집 승인).
- **실제 수정 결과:** v0.16 통합 작업에서 수정 — 통합 후 결과 기입.
- **재검증 여부:** 통합 후. 실제 수집원은 이 환경에서 403이므로 `scripts/archive-probe.mjs` GitHub 워크플로(P06 해결 필요) 또는 운영자 PC에서 확인.

### P09 · blocker · 아카이브 DB · v0.16 db 트랙
- **문제 증상:** 프로젝트·출처·후보·수집 기록을 담을 테이블이 없다.
- **확인된 원인:** 명세(ARCHIVE_SPEC.md 4장)만 있다.
- **영향 범위:** P08·P10·P11 전체.
- **해결 방법:** `supabase/migrations/20261018000000_media_facade_archive.sql`과 `complete-backend.sql` 추가분.
- **실제 수정 결과:** v0.16 통합 작업에서 수정 — 통합 후 결과 기입.
- **재검증 여부:** 통합 후 `npm test`(PGlite). 실DB 적용은 P01과 함께.

### P10 · major · 검토 콘솔 · v0.16 admin 트랙
- **문제 증상:** 현재 콘솔은 v0.10의 서울·도쿄·뉴욕 후보와 글 작성만 다룬다(`admin/index.html`).
  - 도시 선택지 3개 고정, 상태 `ready/draft/published/rejected/hidden`.
  - 아카이브 후보 검토, 출처 관리, 수집 규칙, 오류 화면이 없다.
- **확인된 원인:** 아카이브 기능이 아직 없다.
- **영향 범위:** "웹 정보는 편집 승인 전 공개 금지"(ARCHIVE_SPEC 1장 규칙 1)를 지킬 수단이 없다.
- **해결 방법:** ARCHIVE_SPEC 4장 Admin API와 콘솔.
- **실제 수정 결과:** v0.16 통합 작업에서 수정 — 통합 후 결과 기입.
- **재검증 여부:** 통합 후 `qa/admin*.spec.mjs`.

### P11 · major · 아카이브 탐색 UI · v0.16 client 트랙
- **문제 증상:**
  - 필터가 범위·국가·도시·일정·콘텐츠 구분·연도·무료·실내뿐이다(`explore-filters-390.png`).
  - 프로젝트 유형·설치 방식·기술·외피·운영 상태 필터, 아카이브 상세, KO/EN, 연구용 통계·CSV/JSON 내보내기가 없다.
- **확인된 원인:** 아카이브 데이터가 없고(P09), 화면도 아직 없다.
- **영향 범위:** 연구자 이용, 검색·비교.
- **해결 방법:** ARCHIVE_SPEC 6장.
- **실제 수정 결과:** v0.16 통합 작업에서 수정 — 통합 후 결과 기입.
- **재검증 여부:** 통합 후 E2E.

### P12 · major · 사진 검토 대기열 · 미지정
- **문제 증상:** 서버 사진 수집이 "이름 검색으로 찾은 사진은 관리자 검토 대기"로 넣지만(LAUNCH.md:107), 그 사진을 승인할 화면이 없다.
- **확인된 원인:**
  - `edge-functions/sync-place-media/index.ts:127-132`가 `reviewed:false`로 저장한다.
  - `admin/app.js`에는 사진 관련 코드가 0건이다(`grep -c "media\|discovered_places"` = 0).
  - v0.16 명세의 관리자 API는 아카이브 프로젝트 사진(`archive_admin_set_media`)만 다루고, 기존 `media_assets` 검토 대기는 다루지 않는다.
- **영향 범위:** Wikidata와 정확히 연결되지 않는 수록 장소의 사진은 서버를 켜도 공개될 방법이 없다(QID가 적힌 곳은 12곳뿐이고, 나머지는 이름이 Wikidata와 정확히 같을 때만 자동 연결된다. LAUNCH.md:44).
- **해결 방법:**
  - 관리자 콘솔에 `media_assets` 검토 대기 목록과 승인·거부 RPC 추가.
  - 또는 v0.16 아카이브 사진 흐름으로 합치는 결정.
- **실제 수정 결과:** 미착수.
- **재검증 여부:** 해당 없음.

### P13 · major · Wikimedia 요청 User-Agent · 미지정
- **문제 증상:** 서버 함수 일부가 Wikimedia에 User-Agent 없이(Deno 기본값) 또는 연락처 없는 User-Agent로 요청한다.
- **확인된 원인:**
  - User-Agent 없음: `edge-functions/_shared/commons.ts:71`(refresh-media-rights·cache-commons-media가 사용), `edge-functions/sync-place-media/index.ts:44`(Commons 검색, 시간 제한도 없음), `edge-functions/_shared/image-download.ts:9`(upload.wikimedia.org 다운로드).
  - 연락처 없음: `edge-functions/_shared/discovery.ts:139`, `:198`이 `"ArchitectureOfLight/0.10 (global discovery research app)"`를 보낸다.
  - 비교: `sync-global-places/index.ts:22-51`과 `sync-place-media/index.ts:99`는 설명형 User-Agent를 쓴다.
  - Wikimedia API 접근 정책은 User-Agent를 요구하며, 없는 요청은 예고 없이 차단될 수 있다고 적고 있다.
- **영향 범위:** 서버를 켠 뒤 사진 권리 확인·캐시·검색·후보 발굴이 403이나 속도 제한으로 실패할 수 있다(실환경 검증 필요).
- **해결 방법:** 모든 Wikimedia 요청에 ARCHIVE_SPEC 1장 규칙 4의 User-Agent(연락처 포함)와 시간 제한을 붙이는 공용 fetch로 통일.
- **실제 수정 결과:** 미착수.
- **재검증 여부:** 해당 없음. 수정 후 첫 실서버 실행의 `media_sync_log`·`sync_runs`로 확인.

### P14 · minor · 미완성 커넥터 · 미지정
- **문제 증상:** `sync-seoul-cultural-events`가 배포 목록(`scripts/deploy-edge-functions.sh:14`)에 있다.
  - 하는 일은 서울 열린데이터 100행을 받아 개수만 돌려주는 것뿐이다(`edge-functions/sync-seoul-cultural-events/index.ts:13-18`, `note: "Map provider fields into public.events…"`).
  - `http://`로 요청하고, 시간 제한과 오류 처리가 없다(`:14` `fetch(url).then(r=>r.json())`).
  - 나머지 4개(`refresh-live-place`, `sync-korea-open-data`, `sync-ticketmaster`, `sync-wikidata`)는 501이다.
- **확인된 원인:** v0.4 스캐폴드가 그대로 남았다.
- **영향 범위:** 배포해도 데이터가 들어오지 않는다. 서울 행사 정보 자동 반영이 없다.
- **해결 방법:** 실제 매핑을 구현하거나(키 필요), 배포 목록에서 빼고 문서에 "미구현"으로 표시.
- **실제 수정 결과:** 미착수.
- **재검증 여부:** 해당 없음.

### P15 · major · 배포 대상·도메인 · 운영자
- **문제 증상:** 배포 설정이 네 가지다.
  - `.openai/hosting.json`(ChatGPT Sites), `netlify.toml`, `site-public-cleared/vercel.json`, `.github/workflows/light-architecture-pages.yml`(GitHub Pages).
  - 주소는 `chatgpt.site`로 고정되어 있다: `config.js:4` `PUBLIC_URL`, `index.html` canonical·og:url, `robots.txt:4`, `sitemap.xml`, 인증 리디렉트(`client/cloud.js:81`, `:83`).
- **확인된 원인:** 호스트 결정이 없다.
- **영향 범위:**
  - ChatGPT Sites는 공개 베타이고 OpenAI가 언제든 내릴 수 있다고 안내한다(웹 검색 결과).
  - `_headers`(CSP, `sw.js`·`config.js` no-cache)는 호스트가 지원해야 적용된다. GitHub Pages는 사용자 지정 헤더를 지원하지 않는다.
  - 다른 호스트로 옮기면 인증 메일 링크·canonical이 옛 주소를 가리킨다.
- **해결 방법:**
  1. 운영자가 정식 호스트·도메인 결정.
  2. `PUBLIC_URL`, `index.html` canonical·og, `robots.txt`, `sitemap.xml`, Supabase URL Configuration 일괄 변경.
  3. 선택한 호스트에서 응답 헤더(CSP) 확인.
- **실제 수정 결과:** 외부 설정 필요 — 위 1–3.
- **재검증 여부:** 미실행.

### P16 · major · 실환경 검증 불가 · 운영자
- **문제 증상:**
  - 실제 Wikidata·Commons 테스트 3개 skip.
  - `launch:check` 실접속 불가.
  - 배포본 확인 불가.
- **확인된 원인:** 개발 컨테이너의 외부 접속 정책(0장, 프록시 `connect_rejected`).
- **영향 범위:** v0.14–v0.16의 외부 연동은 모두 녹화 응답으로만 검증됐다.
- **해결 방법:**
  - 이 환경에서 확인하려면 클라우드 환경 설정 Network access → Allowed domains에 다음을 추가: `refwrdfxbhcsguweicle.supabase.co`, `query.wikidata.org`, `www.wikidata.org`, `commons.wikimedia.org`, `upload.wikimedia.org`, `thumb.wikimedia.org`, 배포 주소, v0.16 수집원.
  - 또는 P06 해결 후 GitHub Actions(CI·수집 점검)나 운영자 PC에서 `AOL_TEST_URL=… npm run e2e`, `node scripts/launch-check.mjs release/launch/public-config.js` 실행.
- **실제 수정 결과:** 외부 설정 필요 — 위 조치.
- **재검증 여부:** 미실행.

### P17 · minor · 서버 미연결 상태의 계정 UI · 미지정
- **문제 증상:** 마이 화면 "로그인" 버튼과 저장 화면 "동기화 상태" 버튼이 서버가 없어도 보인다.
- **확인된 원인:** `app.js:234`(`myPage`), `app.js:79`가 `AOLCloud.state.configured`를 보지 않는다. 계정 화면(`account.js:7`)만 이 값을 본다.
- **영향 범위:** 누르면 "준비 중" 화면으로 가서 사용자가 혼란스럽다(U05, U06).
- **해결 방법:** `configured`가 false면 버튼 문구를 "백업"으로 바꾸거나 숨긴다.
- **실제 수정 결과:** 미착수 (`app.js`는 v0.16 client 트랙 소유 파일이라 통합 뒤 수정 권장).
- **재검증 여부:** 해당 없음.

### P18 · minor · 내부 용어 노출 · 미지정
- **문제 증상:**
  - 설정 "실패한 검색"에 `korea:seeds (Failed to fetch), world:seeds (Failed to fetch) …`가 7줄 넘게 나온다.
  - 안내문에 `refresh_days`가 그대로 나온다.
- **확인된 원인:** `app.js:230`(`#globalSyncErrors`: `E(b.id)+' ('+E(b.error)+')'`), `app.js:83`.
- **영향 범위:** 일반 사용자가 이해할 수 없는 개발자 문구다(U01, U02).
- **해결 방법:** "국내 3개·해외 9개 검색 실패 · 잠시 후 다시 시도"처럼 요약하고 원문은 접어두기. `refresh_days`는 "갱신 주기"로 바꾸기.
- **실제 수정 결과:** 미착수.
- **재검증 여부:** 해당 없음.

### P19 · minor · 터치 영역 · 미지정
- **문제 증상:** 카드 저장 버튼 36×36, 카드 "코스" 버튼 높이 32, 사진 출처 버튼 높이 24, 카드 제목 링크 높이 24.
- **확인된 원인:** `styles.css:669`(`.save-button` 36px), `:690`(`.card-bottom .button.small{min-height:32px}`), `:650`(`.image-credit` min-height 24px), `:677`(`.card-link` min-height 24px). 재설계 커밋 `cc6b399` 이후 값이다. STATUS_v0.14.md:27은 "카드 버튼 터치 영역을 44px로 조정"이라고 적고 있다.
- **영향 범위:** WCAG 2.5.8 AA(24px)는 통과(crawl 기준), 권장 44px에는 못 미친다(U04).
- **해결 방법:** 보이는 크기는 유지하고 `::after` 등으로 터치 영역을 44px로 확장.
- **실제 수정 결과:** 미착수.
- **재검증 여부:** 해당 없음.

### P20 · minor · 관리자 사본 불일치 · v0.16 admin 트랙
- **문제 증상:** `admin/index.html`·`admin/styles.css`와 `site-public-cleared/admin/` 사본이 다르다. 배포되는 쪽은 `site-public-cleared/admin/`이다.
- **확인된 원인:** `scripts/check.mjs:13`은 `app.js`만 비교한다. ARCHIVE_SPEC 7장은 두 사본을 같게 유지하라고 한다.
- **영향 범위:** 어느 쪽이 기준인지 혼란이 생기고, 고친 내용이 배포되지 않을 수 있다.
- **해결 방법:** 하나로 맞추고 `check.mjs`가 디렉터리 전체를 비교하게 한다.
- **실제 수정 결과:** v0.16 통합 작업에서 수정 — 통합 후 결과 기입.
- **재검증 여부:** 통합 후 `npm run check`.

### P21 · minor · 관리자 콘솔 비활성 상태 표시 · v0.16 admin 트랙
- **문제 증상:** 서버 미연결 시 "로그인" 버튼이 `disabled`인데 활성처럼 보인다(opacity 1, cursor pointer, 배경 rgb(244,241,255)). 공개 주소에서 개발자용 문구가 노출된다.
- **확인된 원인:** `site-public-cleared/admin/styles.css`에 `:disabled` 규칙이 없다(0건). 문구는 `admin/app.js:13`.
- **영향 범위:** U07, U08.
- **해결 방법:** `.btn:disabled` 스타일 추가, 안내 문구를 운영용으로 변경.
- **실제 수정 결과:** v0.16 통합 작업에서 수정 — 통합 후 결과 기입 (admin 트랙 소유 파일. 통합 시 반영 여부 확인).
- **재검증 여부:** 통합 후.

### P22 · minor · 문서·버전 표기 · 미지정
- **문제 증상:**
  - 개인정보 처리방침 "시행일 2026-10-12 · 버전 0.14.1"(`privacy.html:57`), 이용 안내·계정 삭제 "버전 0.14 · 2026-10-12", 지원 "버전 0.15 · 2026-10-17", 앱 v0.15.0.
  - `README.md:1` "최신 버전: v0.14".
  - `sitemap.xml`에 `about.html`이 없다.
- **확인된 원인:** 수동 표기를 갱신하지 않았다.
- **영향 범위:** 신뢰도 저하. v0.16에서 서버 수집이 늘면 처리방침 3장(외부 서비스) 검토가 필요하다(서버 수집은 개인정보를 다루지 않지만 외부 요청 목록이 바뀐다).
- **해결 방법:** v0.16 통합 시 버전·시행일을 일괄 갱신하고 sitemap에 `about.html` 추가.
- **실제 수정 결과:** 미착수.
- **재검증 여부:** 해당 없음.

### P23 · minor · 출시 점검 스크립트 · 미지정
- **문제 증상:**
  - `launch:check`가 실패 원인을 `"reason": "TypeError"`로만 기록한다.
  - Node 내장 fetch는 프록시 변수를 읽지 않아 프록시 환경에서는 `ENOTFOUND`가 된다.
  - 실행할 때마다 추적 파일 `release/launch/connectivity-report.json`을 덮어쓴다.
- **확인된 원인:** `scripts/launch-check.mjs:15`(`reason:e.name`), `:26`(`writeFile`).
- **영향 범위:** 원인 진단이 어렵고, 실행 후 git 작업 트리가 바뀐다.
- **해결 방법:** `e.cause?.code`·메시지 기록, 출력 경로 인자화(기본은 git 제외 경로).
- **실제 수정 결과:** 미착수.
- **재검증 여부:** 해당 없음.

### P24 · minor · 장소 제보 기능 · 미지정
- **문제 증상:** 장소 제보 API(`client/cloud.js:98` `submit`)와 테이블(`place_submissions`)은 있지만 화면에서 부르는 곳이 없다.
- **확인된 원인:** UI를 만들지 않았다.
- **영향 범위:** 사용자 제보로 아카이브를 넓힐 경로가 없다.
- **해결 방법:** v0.16 아카이브 후보 흐름(`archive_ingest` 또는 관리자 검토)과 연결할지 결정 후 UI 추가.
- **실제 수정 결과:** 미착수.
- **재검증 여부:** 해당 없음.

### P25 · minor · 모바일 앱 빌드 · 운영자
- **문제 증상:** Android·iOS 빌드 성공 기록이 없다.
- **확인된 원인:**
  - 마지막 기록(STATUS_v0.12.md:18-19): Gradle 다운로드 차단, Xcode 없음.
  - 서명 키·스토어 계정은 운영자 소유물이다(LAUNCH.md C단계).
- **영향 범위:** 앱스토어 출시. 웹 출시와는 별개다.
- **해결 방법:** CI `android-debug` 작업(P06 해결 후)과 운영자 PC의 Xcode로 빌드, 서명 키 준비.
- **실제 수정 결과:** 외부 설정 필요 — 위 조치.
- **재검증 여부:** 이번 진단에서 실행하지 않음.

UI 결함(5장)은 위 P07, P17–P19, P21, P22와 아래 U 항목으로 연결된다.

---

## 5. (d) UI 결함 목록

**캡처 방법:**
- 로컬 `dist/`, `node scripts/serve.mjs dist 4173`(운영 `_headers` 적용).
- Chromium, 390×844와 1440×900, 서비스워커 차단. Wikidata·Commons API는 `qa/fixtures.mjs`와 같이 차단했다.
- `mock-*` 캡처는 `tests/fixtures/global-places-fixtures.mjs` 녹화 응답을 쓰고, 이미지 자리에 앱 아이콘 PNG를 넣었다.
- 캡처 파일은 이 세션의 작업 폴더(`diag/shots/`)에만 있고 저장소에는 넣지 않았다.

**전체 결과:**
- 58장 모두 가로 넘침 0이다.
- 페이지 오류(`pageerror`)가 0이다.
- 콘솔 오류는 일부러 막은 API 요청(`ERR_BLOCKED_BY_CLIENT` 468건), 프록시가 막은 Wikimedia 이미지(`ERR_TUNNEL_CONNECTION_FAILED` 20건), 404 페이지의 의도된 404(2건)뿐이다.

**결함 아님으로 확인한 것:**
- 전체 페이지 캡처에서 하단 탭바·상세 하단 버튼줄·데스크톱 사이드바가 중간에 찍히거나 잘려 보이는 것: `position: fixed` 요소의 캡처 방식 때문이다(측정: `ASIDE.sidebar fixed`, `DIV.detail-actionbar fixed`).
- 1440 필터 패널이 오른쪽으로 잘려 보인 캡처(`explore-filters-1440.png`): 열리는 애니메이션 중간이었다. 400 ms 뒤 `left 1040 / right 1440`으로 화면 안에 들어온다(`explore-filters-1440-settled.png`).
- 기록 화면 "+ 기록" 버튼: 끝까지 스크롤하면 푸터 링크와 겹치지 않는다(버튼 top 708, 링크 bottom 688).
- 사진 자리의 "사진을 불러오지 못했어요": 이 환경이 Wikimedia 이미지를 막았기 때문이다.

| ID | 심각도 | 화면·폭 | 결함 | 위치 | 스크린샷 | 연결 |
|---|---|---|---|---|---|---|
| U01 | minor | 설정 390·1440 | "실패한 검색"에 내부 갈래 ID와 브라우저 영문 오류(`Failed to fetch`)가 오른쪽 정렬로 노출(390에서 7줄 이상) | `app.js:230` `#globalSyncErrors` | settings-390.png, settings-1440.png | P18 |
| U02 | minor | 설정 1440 | 안내문에 변수명 `refresh_days` 노출 | `app.js:83` | settings-1440.png | P18 |
| U03 | minor | 홈 (모든 폭) | 문서 제목이 "빛이 머무는 공간,나의 다음 발견. · 빛의 건축" (쉼표 뒤 공백 없음). h1의 `<br>`을 `textContent`로 읽음 | `app.js:92` `document.title=($('#view h1')?.textContent…)` | (측정값) | — |
| U04 | minor | 홈·발견·상세·저장 390 | 카드 저장 36×36, 카드 "코스" 68×32, 사진 출처 높이 24, 카드 제목 링크 높이 24 (44px 권장 미달) | `styles.css:669` `.save-button`, `:690` `.card-bottom .button.small`, `:650` `.image-credit`, `:677` `.card-link` | home-390.png, explore-390.png, place-SEOUL001-390.png | P19 |
| U05 | minor | 마이 390·1440 | 서버 미연결인데 "로그인" 버튼 표시 → "준비 중" 화면 | `app.js:234` `myPage` `.button.tonal.small` | my-390.png, my-1440.png | P17 |
| U06 | minor | 저장 390·1440 | 서버 미연결인데 "동기화 상태" 버튼 표시 | `app.js:79` | saved-2-390.png, saved-2-1440.png | P17 |
| U07 | minor | 관리자 390·1440 | 비활성 "로그인" 버튼이 활성처럼 보임 | `site-public-cleared/admin/styles.css` (`:disabled` 없음), `#loginBtn` | admin-390.png, admin-1440.png | P21 |
| U08 | minor | 관리자 390·1440 | 공개 주소에 "config.js에 SUPABASE_URL / PUBLISHABLE_KEY를 입력하세요" 노출 | `admin/app.js:13` | admin-390.png | P21 |
| U09 | major | 홈 390·1440 | "지금 볼 수 있는 빛의 공간" 카드에 "재확인 시점 경과" 배지가 붙음. "처음이라면 여기부터"에 "수록 프로그램 종료"(DDP)와 "추가 확인 필요" 카드 | `app.js:70` (`now`는 일정상 진행 중만 보고 재확인 기한은 보지 않음) | home-390.png, home-1440.png | P07 |
| U10 | minor | 홈 1440 | 사진이 2장뿐이라 문화역서울284 사진이 히어로·두 레일·코스 03 표지·서울 지역 타일에 반복. "사진으로 살펴보는 공간" 레일은 2장으로 줄 절반이 빔. "어디의 빛을 만나볼까요?"도 2칸 | `app.js:70` 레일 구성 | home-1440.png | P07 |
| U11 | major | 지도 390·1440 | "전체 · 0곳 · 검증 좌표 0곳 · Wikidata 좌표 0곳". 동기화가 되어도 Wikidata 장소만 표시되고 수록 49곳은 지도에 없음 | `catalog.js:12` `mappable` (좌표·출처 필요), seed 좌표 0 | map-390.png, map-1440.png, mock-map-synced-390.png, mock-map-synced-1440.png | P07, P11 |
| U12 | minor | 홈 "세계" 390 | 동기화 실패 시 "빛의 공간을 모으고 있어요"만 표시. 오류·재시도 없음. "지도에서 보기"는 0곳 지도로 감 | `app.js:52` 빈 히어로 | scope-home-world-390.png | — |
| U13 | minor | 상세 390 vs 1440 | 모바일 하단 "지도에서 보기"는 실제로 외부 지도 주소 검색(새 창). 데스크톱은 같은 링크를 "지도에서 주소 검색 ↗"로 표시. 좌표 미확인인데 "보기"라고 함 | `app.js:64` `actionBar`, `app.js:244` | place-SEOUL001-390-fold.png, place-SEOUL001-1440.png | — |
| U14 | minor | 데이터 검토 390 | 표(640px)가 356px 영역에서 가로 스크롤되는데 단서가 없음. "판정" 배지가 경계에서 잘림(배지 right 375 > 영역 374) | `.table-scroll` | audit-390-fold.png | — |
| U15 | minor | 데이터 검토·매거진·큐레이션 | 탭 활성 표시 불일치: `#audit`·`#magazine`은 "발견", `#curation`은 "마이" 강조 | 탭 활성 계산(`app.js` 라우팅) | audit-1440.png, magazine-390.png, curation-CUR001-390.png | — |
| U16 | minor | 코스 1440, 홈 1440 | 사진 실패 상태에서 코스 카드 03의 출처 배지가 실패 표시(아이콘)와 겹침. 실패한 사진에도 출처 배지가 남음 | `styles.css:729` `.curation-card .image-credit` | routes-1440.png, home-1440.png | — |
| U17 | minor | 법적 페이지 | 버전·시행일 표기 불일치(0.14.1 / 0.14 / 0.15, 10-12 / 10-17) | `privacy.html:57`, `terms.html`, `delete-account.html`, `support.html` | privacy-390.png, terms-390.png, delete-account-390.png, support-390.png | P22 |
| U18 | minor | 큐레이션 390·1440 | 날짜 기준 없는 시점 문구: "9월 21일부터 새 전시 시작", "현재 운영 중 야간 미디어파사드" | seed `curation_places` 설명 | curation-CUR001-390.png, curation-CUR001-1440.png | P07 |
| U19 | minor | 발견 390 | 1열 카드(높이 약 330px) 24장이 8,959px. 거의 모두 같은 자리표시 그래픽이라 정보 밀도가 낮음(목록 보기 전환은 있음) | 발견 기본 보기 | explore-390.png | P07 |

---

## 6. v0.16 통합 뒤 이 문서에 채울 것

- P08–P11, P20, P21의 "실제 수정 결과"와 "재검증 여부".
- 통합 후 `npm test`, `npm run build`, `npm run check`, `npx playwright test --workers=2`, `deno check`, `deno test tests/deno/` 결과 수.
- 통합 후 화면 다시 캡처(같은 29개 화면 + 아카이브 필터·상세·연구 화면).
