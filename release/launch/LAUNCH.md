# 빛의 건축 — 출시 실행 순서 (v0.14)

코드 쪽 준비는 끝났습니다. 남은 단계는 모두 **운영자 본인의 계정·결정**이 필요한 일입니다. 위에서부터 순서대로 진행하세요.
각 단계 옆의 확인 방법을 통과해야 다음으로 넘어갑니다.

---

## A단계 — 웹 공개 출시 (비회원 모드). 1번만 하면 바로 가능

비회원 모드: 저장·코스·방문 기록이 기기에 저장되고, 로그인/동기화 버튼은 "서버 연결 대기"로 표시됩니다.

### 1. 운영자 정보 입력 (필수, 법적 요건)
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
그다음 `release/launch/install-six-hour-sync.sql`을 실행합니다.
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
