# v0.15 — 전국·세계 빛 장소 서버 동기화 (sync-global-places)

2026-10-13. 서버(Supabase)를 연결하면 전국·세계 장소의 Wikidata 조회가 방문자 브라우저마다가 아니라 서버에서 6시간에 한 번만 실행된다. 운영 반영은 아직 안 됨(아래 "남은 일").

## 바뀐 것
- **DB** `supabase/migrations/20261013000000_discovered_places.sql` (같은 내용이 `release/launch/complete-backend.sql` 끝에 포함, 둘 다 재실행 안전)
  - `public.discovered_places`: QID 기본키(`^Q[0-9]+$`), 범위(korea/world), 앱의 압축 장소 레코드(jsonb 배열, 첫 원소 = QID), 대표 분류, 좌표, 위키 링크 수, 갈래 목록, P18 파일, 사진 판정(none/pending/cleared/blocked)·사유·출처 표기 행(jsonb 배열)·판정 시각·판정 당시 한국 FoP 정책, first/last_seen_at, synced_at.
  - RLS 켜짐, anon/로그인 사용자 권한·정책 없음. 읽기는 보기 `public.public_discovered_places`로만: 72시간 동안 다시 확인되지 않은 장소와 24시간이 지난 사진 판정은 숨김. 보기는 읽기 전용(Supabase 기본 권한도 회수). Security Advisor에 "Security Definer View"로 표시되는 것은 의도(LAUNCH.md 4단계).
  - 쓰기는 service_role 전용 함수 4개: `apply_discovered_places`(파일이 바뀌면 판정 초기화), `prune_discovered_places`(실패한 갈래가 찾았던 장소는 남김, 30일 넘게 안 보인 것은 삭제), `discovered_images_due`(미확인 → 정책 변경 → 오래된 순), `set_discovered_media`(다른 파일에 대한 판정·사진 없는 cleared는 무시).
- **Edge Function** `edge-functions/sync-global-places` (+ 공용 `edge-functions/_shared/global-places-server.mjs`): `x-aol-cron-secret`/`x-aol-media-admin-secret` 인증(sync-place-media와 같음), 브라우저와 같은 갈래 조회 12개를 설명형 User-Agent로 실행, 사진 권리를 Commons에서 50개씩 확인(`MEDIA_KR_FOP_DISPLAY`, 기본 켜짐), 500행씩 저장, 실행마다 `sync_runs`에 갈래별 상태 기록. 기본 130초 예산(150초 요청 제한 안), 실행 중이면 409. 배포 목록(`scripts/deploy-edge-functions.sh`)과 4번째 예약 `aol-global-places-6h`(`53 3,9,15,21 * * *`, `install-six-hour-sync.sql`)에 추가.
- **앱** `client/global-places.js`: `SUPABASE_URL`+`SUPABASE_PUBLISHABLE_KEY`가 있으면 `public_discovered_places`를 한 번 요청(`apikey` 헤더만, 1000곳 넘으면 Content-Range로 나눠 받음)해 장소와 사진 판정을 함께 사용. 서버에 행이 없거나 오류면 기존 브라우저 조회로 대체. 6시간 캐시 유지(서버 자료가 6시간을 넘으면 최대 30분마다 다시 확인). 브라우저에 없는 사진 판정은 Commons 대신 서버에 먼저 물음. 한국 FoP는 앱 설정을 따로 적용.
- `scripts/launch-check.mjs`에 `discovered_places_view` 확인, `scripts/check.mjs` 인증 확인 목록에 함수 추가, CI에 Deno 로컬 실행 테스트 단계 추가.
- `site-public-cleared/app.js`는 바꾸지 않음(기존 `AOL_GLOBAL`·`AOL_GLOBAL_MEDIA`·`AOLGlobal.imageStatus` 계약 그대로).

## 검증 (이 환경)
- 단위·SQL: 159개 통과(새로 16개: PGlite에서 마이그레이션 재실행·Supabase 기본 권한 아래 anon/로그인 사용자는 보기만 읽기·쓰기/함수 실행 거부·72시간/24시간 숨김·판정 초기화·prune·확인 순서, 서버 행 생성·왕복·판정·실행 논리, 실제 SQL 위에서 6시간 간격 두 번 실행 후 앱이 읽는 끝-끝 테스트, 배포·예약 설정 일치). 보기의 쓰기 권한 회수를 일부러 빼면 테스트가 실패하는 것을 확인.
- Deno 2.5.4: 모든 Edge Function 타입 검사 통과. `tests/deno/sync-global-places_test.ts`가 함수를 외부 요청 전부 흉내 낸 상태로 실행(6개: GET 405·비밀값 없음/틀림 401·외부 요청 없음, 정상 실행의 갈래별 조회·User-Agent·저장·prune·사진 판정·sync_runs, 한국 FoP 끔, 실행 중 409, 전 갈래 실패 502, DB 오류 500). 실제 HTTP로도 띄워 405/401 확인.
- 브라우저(Playwright, 운영 CSP): `qa/global-places-server.spec.mjs` 5개(서버 한 번 요청으로 대체·Wikidata/Commons 조회 없음·사진 표시, 6시간 캐시와 재확인, 서버 비었거나 오류 시 브라우저 조회, 1000곳 넘는 목록 나눠 받기, 사진 판정을 서버에 묻기). 서버 모드를 끄면 5개 모두 실패하는 것을 확인. 전체 E2E 121개 중 118개 통과, 3개 skip(실제 Wikidata·Wikimedia 접속이 필요한 테스트, 이 환경에서 차단).

## 남은 일 (운영자)
- SQL 적용(`complete-backend.sql` 또는 마이그레이션 파일), 함수 배포(9개), `install-six-hour-sync.sql` 재실행, 첫 실행 결과 확인(LAUNCH.md 7단계 "전국·세계 장소 서버 동기화").
- 실제 Wikidata에서의 갈래별 시간, 130초 예산 안에 확인되는 사진 수, Edge Function CPU 제한(2초)은 이 환경에서 확인할 수 없었다(외부 접속 차단). 첫 실행의 응답과 `sync_runs`로 확인.

## 검토 후 수정 (2026-10-17, 서버 동기화)
- **마감 시간 보장**: 사진 확인의 Commons 요청마다(이어받기 단계 포함) 실행 마감에 끊기는 신호를 걸고, 마감이 지나면 다음 요청을 시작하지 않음(`checkDueImages`). 느린 Commons도 실행을 마감 넘어 붙잡지 못함(Node: 실제 시간 400 ms 마감·가상 시계 25 s 단계 / Deno: 함수 전체를 2 s 마감으로 실행해 확인). DB 요청도 하나당 20초 제한.
- **사진 단계 분리**: `{"phase": "images"}` 실행과 예약 `aol-global-places-images-3h`(3시간마다, 장소 실행 30분 뒤와 그 3시간 뒤). 재확인 간격 5시간 → 12시간, 공개 보기의 24시간은 그대로. 사진 실행이 3번 연달아 미루면 경보(`metadata.alerts`).
- **갈래 순서**: 서버에서는 비싼 `korea:name-keywords`를 맨 먼저 따로 시작하고, 나머지는 실행마다 한 칸씩 돌림(`serverBranchOrder`). 같은 갈래가 3번 연달아 실패하면 경보.
- **급감한 갈래**: 저장된 수(최근 72시간, `discovered_branch_counts`)의 절반 미만을 돌려준 갈래는 prune에서 실패로 취급(`suspect`), 실행은 `partial`.
- **동시 실행**: SELECT 후 INSERT 대신 원자적 잠금(`discovered_sync_locks`, `claim/release_discovered_sync`, 예산+60초 뒤 자동 만료, 두 단계 공용). `apply_discovered_places`는 더 새 실행이 쓴 행을, `set_discovered_media`는 더 새 판정을 덮어쓰지 않음.
- **예산 상한**: `budget_ms`는 최대 130000(150초 게이트웨이 504 때문, 요금제 무관). LAUNCH.md의 380000 안내 삭제.
- **편집 차단**: `discovered_places.place_block`(장소 숨김)·`image_block`(사진 차단, 파일이 바뀌어도 유지). 공개 보기·`discovered_images_due`·`set_discovered_media`·prune이 모두 따름.
- **테스트**: Deno 스텁이 잠금을 실제처럼 흉내 내고 sync_runs 조회는 요청의 필터대로만 답함(필터를 망가뜨리면 실패). SQL: 잠금·겹친 실행·편집 차단·갈래 수·v0.15.0 마이그레이션에서의 업그레이드(`tests/sql/discovered_places_v0.15.0.sql`).
