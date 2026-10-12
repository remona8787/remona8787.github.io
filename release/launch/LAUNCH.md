# 빛의 건축 — 출시 실행 순서 (v0.14.1)

코드 쪽 준비는 끝났습니다. 남은 단계는 모두 **운영자 본인의 계정·결정**이 필요한 일입니다. 위에서부터 순서대로 진행하세요.
각 단계 옆의 확인 방법을 통과해야 다음으로 넘어갑니다.

---

## A단계 — 웹 공개 출시 (비회원 모드). 1번만 하면 바로 가능

비회원 모드: 저장·코스·방문 기록이 기기에 저장되고, 로그인/동기화 버튼은 "서버 연결 대기"로 표시됩니다.

### 1. 운영자 정보 입력 (필수, 법적 요건) — ✅ 완료
김지현 (JIHYUN KIM) / remona56@hanmail.net 입력됨. 바꿀 때는 아래 값을 수정합니다.
`site-public-cleared/config.js`에서 아래 값을 채웁니다.

```js
OPERATOR_NAME: '홍길동',            // 개인이면 실명, 사업자면 상호
PRIVACY_OFFICER: '홍길동',          // 비우면 OPERATOR_NAME 사용
SUPPORT_EMAIL: 'help@example.com', // 실제로 수신 확인하는 주소
```

개인정보 처리방침·이용 안내·지원·계정 삭제 페이지에 자동으로 표시됩니다. 비어 있으면 페이지에 빨간 "(운영자 등록 전)" 표시가 나옵니다.
확인: `node scripts/launch-check.mjs` 결과에서 `operator_contact: passed`.

> 처리방침(`privacy.html`)은 현재 코드가 실제로 하는 일을 기준으로 개인정보 보호법 항목 구조에 맞춰 작성했습니다. 법률 자문은 아니므로, 상용 운영 전에 한 번 검토받기를 권합니다.

### 2. 빌드·배포
```
npm ci
npm test && npm run build
```
`dist/` 폴더를 배포합니다. 자세한 방법은 `site-public-cleared/DEPLOY.md`를 참고하세요. 현재 주소(ChatGPT Sites)는 `.openai/hosting.json`이 `dist`를 가리킵니다.

### 3. 실제 주소에서 검증
```
AOL_TEST_URL=https://light-architecture-jihyun.peppydegu2.chatgpt.site npm run e2e
```
화면 크롤링·접근성·오프라인·사진 표시까지 실제 주소에서 확인합니다. 사진 테스트는 Wikimedia에 접속할 수 있는 환경에서만 실행되고, 그렇지 않으면 skip으로 표시됩니다.

**여기까지 통과하면 웹 공개 출시가 가능합니다.**

### 장소 사진·정보 자동 동기화 (A단계부터 동작, 서버 불필요)
- 방문자의 브라우저가 최대 6시간에 한 번 Wikidata·Wikimedia Commons에서 장소 사진과 정보(공식 웹사이트, 위치, Commons 사진 모음)를 가져옵니다. 결과는 브라우저에 저장되고, 갱신이 실패하면 이전 결과를 계속 씁니다.
- **장소 연결 규칙**: 장소 이름이 Wikidata 항목의 한국어·영어 이름과 정확히 같고 그 항목이 서울에 있을 때만 연결합니다. 같은 이름의 항목이 둘 이상이면 연결하지 않습니다. "○○ 미디어파사드"처럼 건물에 설치된 프로젝트는 건물 항목과 연결하고 "프로젝트가 있는 건물(○○)의 사진"으로 표시합니다.
- **표시 조건**: CC BY·CC BY-SA·CC0·퍼블릭 도메인만 표시합니다(NC·ND 제외). Commons에서 삭제 요청·저작권 침해·허가 누락 태그가 붙은 파일은 표시하지 않습니다. 사진마다 촬영자·라이선스·촬영일·원본 링크·사용조건 링크를 표시합니다.
- **한국 건축물 사진(파노라마의 자유)**: 출처 표기는 사진가의 라이선스 조건을 충족하지만, 건물·공공미술 자체의 저작권과는 별개입니다. 저작권법 제35조 제2항은 개방된 장소에 항상 전시된 건축물·미술저작물을 판매 목적이 아니면 복제·이용할 수 있게 하므로, 무료 서비스에서 표시하는 것은 이 범위로 보고 기본으로 켜 두었습니다(`MEDIA_KR_FOP_DISPLAY`). 미디어파사드 화면에 상영 중인 영상 작품은 "항상 전시"로 보기 어려울 수 있으니, 이의가 오면 바로 내리세요. 법률 자문은 아닙니다.
- **사진 내리기**: `site-public-cleared/assets/media-blocklist.js`에 파일 이름(예: `'DDP night.jpg'`)이나 장소 ID(예: `'SEOUL006'`)를 넣고 빌드·배포합니다. 이용 안내와 지원 페이지에 신고 경로가 있습니다.
- **확인**: [데이터 및 설정 → 장소 사진·정보 동기화]에서 마지막 동기화 시각과 연결된 장소·사진 수를 볼 수 있고, "지금 동기화"로 바로 갱신할 수 있습니다. 실제 주소에서 `npm run e2e`를 실행하면 실제 Wikidata로 동기화 테스트도 함께 돌아갑니다.
- 사진이 몇 곳에 붙을지는 Wikidata에 등록된 항목에 달려 있어 배포 후에 확인됩니다. 미디어파사드·전시처럼 Wikidata 항목이 없는 곳은 계속 "사진 준비 중"으로 남습니다. Wikidata에 항목과 대표 사진(P18)을 등록하면 다음 동기화 때 자동으로 반영됩니다.

---

## B단계 — 계정·기기 간 동기화 켜기

Supabase 프로젝트: `refwrdfxbhcsguweicle` (Seoul). 대시보드에 로그인한 상태에서 진행합니다.

### 4. 데이터베이스 마무리
SQL Editor에서 `release/launch/complete-backend.sql` 전체를 붙여 넣고 실행합니다.
- 하나의 트랜잭션입니다. 실패하면 아무것도 바뀌지 않습니다.
- 여러 번 실행해도 안전합니다(이전 시도가 일부 적용됐어도 됨). 로컬 Postgres에서 검증했습니다(`tests/sql.test.mjs`).

확인: `node scripts/launch-check.mjs release/launch/public-config.js`에서 `public_catalog`, `editorial_articles` 항목이 passed.

### 5. 인증 메일 설정 (중요)
- **Authentication → URL Configuration**
  - Site URL: 실제 공개 주소
  - Redirect URLs: 같은 주소 추가
- **Authentication → Emails → SMTP Settings**: 외부 SMTP(Resend, Amazon SES 등)를 연결합니다.
  Supabase 기본 메일 발송은 프로젝트 팀원 주소로만, 그것도 적은 횟수만 보내므로 일반 사용자의 가입 확인·비밀번호 재설정 메일이 도착하지 않습니다.

확인: 팀원이 아닌 이메일로 가입 → 확인 메일 수신 → 링크로 복귀.

### 6. Edge Functions 배포
Supabase 대시보드 → Account → Access Tokens에서 토큰을 만든 뒤:
```
SUPABASE_ACCESS_TOKEN=sbp_... ./scripts/deploy-edge-functions.sh
```
- 계정 삭제·사진 수집·후보 발굴·관리자 명령 등 8개 함수를 배포합니다. 501 스텁 4개는 배포하지 않습니다.
- `MEDIA_CRON_SECRET`, `MEDIA_ADMIN_SECRET`를 생성해 함수에 설정하고, `.secrets/edge-secrets.env`에 저장합니다(git 제외).

### 7. 6시간 자동 갱신 (선택)
SQL Editor에서 Vault 비밀 3개를 만듭니다. `media_cron_secret` 값은 `.secrets/edge-secrets.env`의 `MEDIA_CRON_SECRET`과 같아야 합니다.
```sql
select vault.create_secret('https://refwrdfxbhcsguweicle.supabase.co','project_url');
select vault.create_secret('<publishable key>','publishable_key');
select vault.create_secret('<MEDIA_CRON_SECRET 값>','media_cron_secret');
```
그다음 `release/launch/install-six-hour-sync.sql`을 실행합니다. 사진 작업은 매 실행마다 게시된 모든 장소를 Wikidata와 다시 대조하고(같은 연결 규칙), 바뀌지 않은 사진은 다시 내려받지 않습니다. 정확히 연결된 사진만 자동으로 게시되고, 이름 검색으로 찾은 사진은 관리자 검토 대기로 들어갑니다.
서버를 연결하면(9단계) 앱은 서버의 사진 목록을 우선 사용하므로, **9단계 전에 이 예약을 먼저 설치하고 한 번 실행해 사진이 채워졌는지 확인하세요.**
확인: 다음 실행 시각 이후 `select * from cron.job_run_details order by start_time desc limit 10;`와 `ingestion_jobs`/`media_sync_log`에 성공 기록이 있는지 봅니다. 예약 등록만으로 수집이 성공한 것은 아닙니다.

### 8. 관리자 계정 지정
사이트에서 본인 계정으로 가입한 뒤 SQL Editor에서:
```sql
insert into public.app_admins(user_id, role, can_promote, can_run_discovery)
select id, 'owner', true, true from auth.users where email = '본인 이메일'
on conflict (user_id) do update set role='owner', can_promote=true, can_run_discovery=true;
```

### 9. 앱에서 서버 연결 켜기
`release/launch/public-config.js`의 `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` 두 값을 `site-public-cleared/config.js`에 복사하고 2~3단계(빌드·배포·검증)를 다시 실행합니다.
서비스워커 캐시 이름은 빌드할 때 자동으로 바뀌므로, 기존 방문자도 새 설정을 받습니다.

확인 (직접, 계정 2개):
- [ ] A 계정에서 장소 저장·방문 기록 → 다른 기기/브라우저에서 A로 로그인 시 보임
- [ ] B 계정에서는 A의 기록이 보이지 않음
- [ ] 방문 사진 업로드 → 본인만 열람, 삭제 가능
- [ ] 비밀번호 재설정 메일 → 새 비밀번호 설정
- [ ] 계정 삭제 → 다시 로그인 불가, 사진 삭제됨
- [ ] `node scripts/launch-check.mjs`의 모든 항목 passed

---

## C단계 — 앱스토어 (선택)
Google Play 개발자 계정(25달러, 1회)과 Apple Developer Program(연 99달러), 서명 키, 스토어 스크린샷·설명이 필요합니다. `mobile/STORE_RELEASE.md`와 `release/Store_Metadata_v0.12.md`를 참고하세요. 웹 출시와는 독립적으로 진행할 수 있습니다.

## 알려진 한계 (출시를 막지는 않음)
- 실제 사진이 있는 장소는 2곳입니다. 한국은 건축물·공공미술의 파노라마 자유(FoP)가 제한되어, Commons 사진도 개별 권리 검토 없이 자동으로 공개하지 않습니다. 나머지는 "사진 준비 중"으로 표시됩니다.
- 좌표가 검증된 장소가 없어 지도 핀이 표시되지 않습니다(추정 좌표를 쓰지 않는 정책).
- OpenStreetMap 기본 타일은 SLA가 없습니다. 트래픽이 늘면 `TILE_URL`을 교체하세요.
