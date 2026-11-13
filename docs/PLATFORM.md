# 빛의 건축 v2.0 회원·연구·커뮤니티 플랫폼

공개 아카이브(GitHub Pages)는 그대로 두고, 회원·연구자·커뮤니티 기능은 별도의 관리형 백엔드(Supabase)에 연결하는 구조입니다.
**지금 공개 사이트에는 회원 기능이 켜져 있지 않습니다.** `site-public-cleared/config.js`의 `SUPABASE_URL`이 비어 있는 동안에는
로그인·업로드·연구데이터 다운로드 화면이 "준비 중"으로만 보이고, 어떤 양식도 나타나지 않습니다.
서버 설정과 보안 점검(이 문서 6절)을 마치기 전에는 켜지 마세요.

## 1. 구성

| 부분 | 어디 | 무엇 |
|---|---|---|
| 공개 아카이브 | GitHub Pages (`main`) | 검색, 지도, 상세 페이지, 공개 데이터 패키지(`data/research/`), 공개 커뮤니티 화면 |
| 인증·DB | Supabase Auth, Postgres | 회원, 역할, 연구자 신청·승인, 후기·댓글·사진·제보, 신고, 이의신청, 검수 기록, 감사 로그 |
| 비공개 저장소 | Supabase Storage `community-uploads`(비공개), `research-datasets`(비공개) | 검수 전 사진, 연구용 패키지 |
| 공개 저장소 | Supabase Storage `community-photos`(공개) | 검수를 통과해 메타데이터를 지운 이용자 사진 |
| 서버 함수 | Supabase Edge Functions | `research-download`(서명 URL), `publish-photo`(사진 공개·내림), `moderate-queue`(자동 검수), `delete-account` |

코드:

- `supabase/migrations/20261112000000_v2_platform.sql` — 표, RLS, 상태 전이, 관리자 함수 전부
- `supabase/migrations/20261113000000_v2_photo_grades.sql` — 사진 등급·촬영자 표시·중복 방지
- `supabase/migrations/20261113010000_v2_admin_members.sql` — 회원 목록·연구 권한·다운로드 기록(운영자), 공개 프로필
- `release/launch/platform-v2.sql` — 위 v2 마이그레이션(연구데이터 `20261026000000` 포함) 묶음, 한 트랜잭션, 다시 실행해도 안전
  (`npm run platform:bundle-sql`로 만듦, 손으로 고치지 않음)
- `release/launch/install-platform-cron.sql` — 자동 검수(5분마다)와 만료 처리(매일) 예약
- `scripts/platform-deploy.mjs`, `.github/workflows/platform.yml` — 운영 프로젝트 점검·설치·실제 점검(6절)
- `scripts/platform-e2e.mjs` — 실제 서버 종단 점검(가입·인증·글·사진·연구자·계정 삭제·운영자 목록, 78개 항목),
  `qa/real-backend.spec.mjs` — 같은 흐름을 휴대전화·데스크톱 브라우저로
- `edge-functions/{moderate-queue,publish-photo,research-download,delete-account}/index.ts`
- `edge-functions/_shared/platform/` — 검수 규칙·판단(`moderation.mjs`), 분류 요청(`classify.mjs`), 사진 검사(`image-check.mjs`),
  중복·링크 검사(`submissions.mjs`), 관리자 확인(`staff.ts`)
- 화면: `site-public-cleared/platform.js`(이용자), `site-public-cleared/admin/app.js`의 "회원 활동 검수" 탭(운영자),
  `client/platform-api.js`(서버 연결, 서버가 설정된 경우에만 불러옴)
- 연구용 패키지: `scripts/researcher-package.mjs` (공개 패키지 `scripts/research-package.mjs`와 별개)

## 2. 권한 원칙 (데이터베이스가 강제)

- 역할·승인은 서버만 바꾸는 표에만 있습니다: `app_admins`(admin·editor), `member_status`(정지·차단),
  `researcher_applications`의 결정 칸, `research_grants`. 이용자가 고칠 수 있는 프로필이나 Supabase 사용자 메타데이터는
  어떤 판단에도 쓰지 않습니다.
- 운영 기능(검수, 연구자 승인, 회원 제한, 역할 변경)은 admin 또는 editor 역할과 **2단계 인증(MFA, JWT `aal2`) 세션**이
  모두 있어야 합니다. 연구자 승인과 회원 제한·역할 변경은 admin만 합니다. 마지막 admin은 지울 수 없습니다.
- 이용자의 모든 글·사진·제보는 `draft`(임시 저장) 또는 `pending`(검수 대기)로만 들어갑니다. `approved`(공개)·`rejected`(반려)·
  `removed`(게시 중단)·`needs_review`(사람 검토)는 운영자 함수나 자동 검수 함수만 정합니다. 공개된 글을 고치면 다시 `pending`이
  되어 내려갑니다. 게시 중단된 글은 고칠 수 없습니다(이의신청은 가능).
- 공개 화면은 공개 승인된 것만, 회원 ID 없이 보여 주는 뷰(`community_public_posts`, `community_public_comments`,
  `community_public_photos`)만 읽습니다.
- 이메일 인증을 마치지 않은 계정, 정지·차단된 계정은 쓰기가 막힙니다.
- 운영 콘솔(`/admin/`)은 회원 사이트와 같은 주소에 있지만 **세션을 따로** 둡니다(저장 키 `aol-console-auth`). 콘솔에 들어가도 사이트의
  로그인은 그대로이고, 콘솔에서 로그아웃하면 그 콘솔 세션만 끝납니다. admin·editor는 처음 들어올 때 인증 앱(TOTP)을 한 번 등록하고,
  그다음부터 로그인할 때마다 6자리 코드를 넣습니다. 연구자 역할은 2단계 인증이 필요 없습니다.
- 운영 콘솔 "회원" 탭(admin): 회원 목록(이메일, 가입·최근 로그인, 이메일 인증, 상태, 역할, 글·사진·제보 수, 연구자 신청 상태)과
  검색, 정지·차단·해제, 역할 지정, 연구 권한 목록과 취소, 다운로드 기록. 회원 목록은 이메일을 보여 주므로 볼 때마다 감사 로그에
  남습니다(`member_list_viewed`). 권한 확인은 모두 서버(`platform_require`)에서 합니다. 화면을 고쳐도 우회되지 않습니다.

## 3. 연구자 인증과 연구데이터

순서: 회원가입 → 이메일 인증 → 연구자 신청 → admin 검토(승인·보완 요청·반려) → 데이터셋별 이용 권한(기본 1년, 최대 2년) → 다운로드.

- 이메일 인증은 이메일 주소를 확인할 뿐 신원·소속 인증이 아닙니다. 화면과 운영 콘솔 모두 이렇게 적혀 있습니다.
- **증빙 파일을 받지 않습니다.** 재직증명서·학생증 대신 기관 소개 페이지, ORCID, 논문 같은 공개 링크나 지도교수 연락 같은 설명으로
  확인하고, 부족하면 보완을 요청합니다(학생·독립연구자도 신청 가능). 민감한 서류를 저장하지 않으므로 보관·삭제 절차가 필요 없습니다.
- 다운로드 확인(`research_download_check`, 서비스 역할만 호출): 활성 데이터셋, 버전·형식, 이메일 인증, 계정 제한 없음,
  승인된 신청(만료 전), 현재 이용조건 버전, 해당 데이터셋의 만료·취소되지 않은 권한. 하나라도 아니면 이유 코드로 거절합니다.
- 서명 URL 유효시간 120초. 승인을 취소하거나 권한이 만료되면 **다음 요청부터 즉시** 거절됩니다. 이미 발급된 URL은 최대 120초 동안
  유효하고, 이미 내려받은 파일은 회수할 수 없습니다(이용조건으로만 관리).
- 시간당 30회 다운로드 제한, 모든 요청 기록(`research_downloads`).
- 데이터 등급: 공개 패키지는 지금처럼 누구나 받습니다(`data/research/`). 연구용 패키지는 공개 기록에 품질·검증 정보(이미지 상태와
  누락 사유, 후보 수, 링크 점검 결과, 파생 변수, 데이터 사전)를 더한 것입니다. **Wikidata(CC0) 등 원자료에 없던 이용 제한을 붙이지
  않습니다.** 원자료의 값은 공개 사이트와 공개 패키지에서 그대로 자유롭게 쓸 수 있고, 승인 절차는 편집·정리된 연구용 묶음의 제공
  방식에 대한 것입니다.
- 형식: CSV(UTF-8 BOM, 수식 주입 방지), JSON, GeoJSON, XLSX(openpyxl·LibreOffice로 읽기 확인), 데이터 사전(JSON·MD),
  SHA-256 체크섬, 인용 문구.

연구용 패키지 만들기와 올리기(운영자):

```
node scripts/researcher-package.mjs --data=<data 브랜치 체크아웃> --out=/tmp/researcher --version=2.0.0
# Supabase Storage → research-datasets → aol-research/2.0.0/ 에 csv·json·geojson·xlsx 업로드
# SQL 편집기: research_datasets에 ('aol-research', ..., tier 'researcher') 등록 후 manifest.json의 catalog_sql 실행
```

## 4. 커뮤니티와 사진

- 후기(작품 필수)·질문·소식, 댓글, 좋아요, 신고, 이의신청. 방문일은 본인이 적은 값이며 "방문 인증"으로 표시하지 않습니다.
- 사진: 브라우저에서 JPEG로 다시 만들어 EXIF·GPS를 지운 뒤 비공개 버킷에 올립니다(긴 변 최대 3000px, 600×400 이상, 8MB 이하).
  네 가지 확인(직접 촬영, 허락할 권리, 식별 가능한 사람 없음 또는 동의, 작품 자체의 권리 안내)이 모두 필요합니다.
  이용 허락은 기본이 "이 사이트에서 저작자 표시와 함께 게시"뿐이고, CC BY 4.0·CC BY-SA 4.0은 이용자가 고를 때만입니다.
  포괄적인 권리 양도는 받지 않습니다.
- 사진은 **항상 사람이 봅니다.** 운영자가 "확인 후 공개"를 누르면 `publish-photo`가 파일 서명·크기·해상도를 다시 확인하고,
  JPEG APP1~APP15(EXIF·XMP)·주석, PNG 텍스트 청크, 파일 끝 뒤에 붙은 데이터를 지운 뒤 공개 버킷에 씁니다.
  게시 중단(`action: remove`)은 공개 파일을 지웁니다. 브라우저·CDN 캐시는 최대 1시간 남을 수 있습니다.
- v2.0 이미지 등급(`supabase/migrations/20261113000000_v2_photo_grades.sql`, docs/IMAGE_GRADES.md): 회원은 촬영자 이름(표시용,
  80자, 링크 불가)을 적을 수 있고, 비우면 표시 이름이 쓰입니다. 공개할 때 운영자가 등급(A 프리미엄 · B 일반 · C 맥락)을 반드시 고르고,
  `publish-photo`가 정리한 파일의 SHA-256을 기록해 같은 파일이 두 번 공개되지 않게 합니다(`duplicate_photo`). 등급과 해시는 회원이
  쓸 수 없습니다(트리거가 지움). 승인 단계: ① 파일 안전성(서명·크기·메타데이터) ② 권리 확인(네 가지 확인, 이용 허락 범위)
  ③ 작품 식별(사람) ④ 중복(같은 파일) ⑤ 화질(등급) ⑥ 운영자 검토 ⑦ 등급 부여 ⑧ 공개 갤러리 ⑨ 공식 대표 이미지 채택은 별도 결정.
  촬영자가 사진을 찍었다는 것만으로 사진 속 작품(영상·조명·조형물)의 권리가 생기지는 않는다고 양식에 안내합니다.
- 이용자 사진은 상세 페이지에서 "이용자 사진" 표시와 점선 테두리로 공식 자료와 구분됩니다. 공식 대표 이미지 채택은 별도 결정
  (`platform_photo_official`, CC 라이선스로 제안된 공개 사진만)이며, 채택된 사진은 편집 결정(`set_image`)으로 수집기에 넣습니다.
- 회원은 자기 글·댓글을 고치거나 지울 수 있고(공개된 글을 고치면 다시 검수 대기), 자기 사진을 거둘 수 있습니다(`publish-photo`
  `withdraw`: 공개 파일과 원본을 지우고 기록을 없앰). 화면: "내 활동"(`#community/mine`).
- 공개 프로필(`#community/member/<공개 ID>`): 회원 ID가 아니라 무작위 공개 ID로만 보이고, 표시 이름·소개·가입일·공개 글 수와 공개 글
  목록만 나옵니다. 회원이 "프로필 공개"를 끄면 글에 이름만 남고 프로필 링크가 사라집니다. 표시 이름에는 링크·이메일·전화번호와
  운영자처럼 보이는 이름(운영자·관리자·admin·staff 등)을 쓸 수 없고, 소개는 글과 같은 규칙(링크 2개 이상, 단축 URL, 연락처 등)을
  데이터베이스가 막습니다. 정지·차단된 회원의 프로필은 보이지 않습니다.
- 제보·등록 신청: 제보(이름+링크), 새 프로젝트, 작가·제작사 본인 작품, 기존 사례 정정, 행사 일정. 임시 저장 가능, 제출할 때 종류별
  필수 항목을 데이터베이스가 확인합니다. 자동 검수 함수가 공개 색인과 이름을 비교해 중복 후보를, 링크 정책(사설 IP·자격증명 URL·
  이상한 포트 거부)을 `checks`에 남깁니다. 승인되기 전에는 공식 목록·검색엔진에 나오지 않습니다.
- 승인된 새 프로젝트는 운영자가 프로젝트 ID(`REG-CM-0001` 형식)를 주고, 레지스트리 기록(`editorial/registry/`)으로 옮겨
  수집기가 공개합니다. 레지스트리·편집 결정은 자동 수집이 덮어쓰지 않습니다(편집 결정이 우선). 승인 기록은
  `community_submissions.approved_project_id`와 감사 로그에 남습니다.

## 5. 자동 검수

`moderate-queue`가 몇 분마다(pg_cron) 검수 대기 항목을 처리합니다.

1. 규칙(데이터베이스에도 같은 핵심 규칙): 위험한 링크 형식(`javascript:` 등) 차단, 링크 4개 이상 차단, 주민등록번호·휴대전화·
   이메일·계좌번호, 단축 URL, IP 주소 링크, 퓨니코드 도메인, 피싱 문구+링크, 반복 문자, 광고·도박 문구 → 사람 검토.
2. 문맥 분류(선택): `ANTHROPIC_API_KEY`가 있으면 Claude API(기본 `claude-opus-5-5`, `MODERATION_MODEL`로 변경)로 11개 범주
   점수를 JSON으로 받습니다. 예술 작품 속 누드·폭력·정치적 메시지는 위반이 아니라고 명시하고, 그 경우 `art_context`를 표시합니다.
   거절 응답(refusal)은 안전으로 보지 않고 사람 검토로 보냅니다. 서버 측 대체 모델(fallbacks)을 켜 두었습니다.
3. 판단: 미성년자와 성적 내용이 함께 있을 가능성(≥0.2) → 반려·에스컬레이션, 고위험 범주 ≥0.85 → 반려, ≥0.35 또는 규칙 표시 →
   사람 검토, 그 밖 → 승인 제안. **자동 승인은 기본 꺼짐**(`platform_settings.auto_approve_text=false`): 꺼져 있으면 승인 제안도
   사람 검토로 갑니다. 사진·제보는 설정과 관계없이 항상 사람이 봅니다.
4. 신고: 서로 다른 회원 3명의 신고 또는 아동 안전 신고 1건이면 공개 항목이 즉시 가려지고 사람 검토로 갑니다. 비회원은
   저작권 침해 신고만(회신 이메일 필수) 할 수 있고, 처리하면 이메일은 지워집니다.

**측정 결과(`tests/fixtures/moderation/eval.json`, 정상 15·경계 8·유해 17건):** 규칙만으로 유해 17건 중 12건을 차단하거나
표시했고, 정상·경계 23건 중 표시가 붙지 않아야 할 항목에 잘못 붙은 것은 0건입니다. 규칙이 놓친 5건(괴롭힘, 혐오 2, 협박,
성적 유인)은 문맥 분류나 사람 검토가 필요합니다. 분류기 없이 운영하면 모든 항목이 사람 검토로 가므로 유해 항목이 자동 공개되는 일은
없지만, 운영자 부담이 큽니다. **문맥 분류기의 정확도는 API 키가 없어 측정하지 못했습니다(미검증).** 키를 넣은 뒤
`scripts/moderation-eval.mjs`로 같은 평가 세트를 돌려 기준을 정하세요. 어떤 방식도 유해 콘텐츠를 100% 거르지 못합니다.
이미지 유해성(특히 아동 성착취물) 자동 탐지는 없습니다. 모든 사진을 사람이 보는 이유입니다. 아동 성착취물로 보이는 자료는
내려받거나 전달하지 말고 즉시 게시 중단하고 관계 기관(경찰청 사이버수사, 방송통신심의위원회 등)에 신고하는 절차를 운영자가
정해 두세요(법률 검토 필요).

## 6. 켜기 전에 (운영자)

운영 프로젝트: `refwrdfxbhcsguweicle`(서울, `release/launch/public-config.js`). v0.15에서 일부만 적용된 상태입니다
(`release/launch/STATE.md`). 아래 순서는 이 저장소의 로컬 Supabase(Postgres 17, Auth·Storage·Edge Functions)에서 같은 상태를 만들어
끝까지 돌려 확인했습니다(9절). **이전 판의 "migrations만 날짜순 실행"은 틀렸습니다**: 번호 붙은 기본 SQL 없이 마이그레이션만 실행하면
`places`가 없어 멈춥니다.

설치 순서(SQL):

1. 기본 스키마가 없을 때만: `supabase/01, 02, 03, 05, 08, 10` (v0.15가 적용한 것과 같은 묶음)
2. `release/launch/complete-backend.sql` (나머지 기본 SQL과 아카이브·전국 장소, 한 트랜잭션, 다시 실행해도 안전)
3. `release/launch/platform-v2.sql` (연구데이터·v2 플랫폼·사진 등급·회원 관리, 한 트랜잭션, 다시 실행해도 안전)
4. Vault 비밀 `project_url`, `publishable_key`, `moderation_cron_secret` 뒤 `release/launch/install-platform-cron.sql`

### 6-1. GitHub Actions로 (권장)

운영자가 할 일(값은 채팅이나 저장소에 붙여 넣지 않습니다):

1. GitHub 저장소 Settings → Secrets and variables → Actions → New repository secret:
   - `SUPABASE_ACCESS_TOKEN`: Supabase 대시보드 → Account → Access Tokens에서 만든 개인 토큰(점검·설치용).
     이 토큰은 계정의 모든 프로젝트를 바꿀 수 있으니, 설치가 끝나면 지우거나 다시 만들 때까지 보관만 하세요.
   - `MODERATION_CRON_SECRET`: 긴 무작위 값(영문·숫자 32자 이상). 예: 터미널에서 `openssl rand -hex 32`.
   - `SUPABASE_SECRET_KEY`: 대시보드 → Project Settings → API Keys의 secret 키(실제 점검용 시험 계정을 만들고 지움).
   - 선택 `ANTHROPIC_API_KEY`: 문맥 분류기(유료, 7절). 넣지 않으면 모든 글이 사람 검토로 갑니다.
2. Actions 탭 → **platform** → Run workflow:
   - `inspect`(기본, 읽기 전용): 설치된 것과 빠진 것을 표로 보여 줍니다. 무엇도 바꾸지 않습니다.
   - `apply`: confirm 칸에 `refwrdfxbhcsguweicle`을 적어야 실행됩니다. 위 SQL 순서, Vault 비밀, 함수 4개(`research-download`,
     `publish-photo`, `moderate-queue`, `delete-account`)와 함수 비밀값(`MODERATION_CRON_SECRET`, `ALLOWED_ORIGINS`,
     `PUBLIC_SITE_URL`, 있을 때만 `ANTHROPIC_API_KEY`·`MODERATION_MODEL`), 예약, Auth 설정(이메일 인증 필수, 비밀번호 12자 이상,
     TOTP 등록·확인 켜기, 사이트 주소·리디렉트 허용 목록에 `https://remona8787.github.io`)을 적용합니다. 이미 더 엄격한 값은 그대로
     둡니다. **운영 데이터베이스를 바꾸는 작업입니다**: 실행 전에 Supabase 대시보드 → Database → Backups에서 백업이 있는지
     확인하세요(무료 플랜은 자동 백업이 없습니다).
   - `verify`: 실제 프로젝트에서 종단 점검(`scripts/platform-e2e.mjs`)을 돌립니다. 시험 계정 `e2e-…@example.com`은 서비스 키로
     만들고 끝에 지웁니다. **이메일을 보내지 않습니다**(받을 수 없는 시험 주소로 보낸 메일이 반송되면 발송이 제한될 수 있어서).
3. 이메일: Authentication → SMTP에서 자체 SMTP를 연결합니다(Supabase 기본 발송은 시험용이라 팀원 주소로만 갑니다). 링크 추적은
   꺼야 인증 링크가 깨지지 않습니다. 연결 뒤 본인 실제 주소로 사이트에서 한 번 가입해 인증 메일의 링크로 확인하세요(verify가
   대신하지 못하는 유일한 단계).
4. 본인 계정을 admin으로(사이트에서 가입·인증 후 SQL 편집기, 아래). 그 뒤 `/admin/`에 로그인해 인증 앱을 등록합니다.
5. 연구용 패키지 업로드(3절)와 `research_datasets` 등록.
6. 법적 문서(8절) 검토와 게시. 개인정보 처리방침에 국외 이전(Supabase·이메일 발송·검수 API) 항목을 넣어야 합니다.
7. 보안 점검: Supabase Advisors(보안·성능), `inspect`가 모두 ✅인지, `verify` 통과.
8. 마지막으로 `site-public-cleared/config.js`에 `SUPABASE_URL`과 공개용 `SUPABASE_PUBLISHABLE_KEY`(`release/launch/public-config.js`의
   값, 서비스 키 아님)를 넣고 배포하면 공개 사이트에 회원 기능이 켜집니다. 이 단계는 운영자가 결정합니다.

```sql
-- 운영자 계정(사이트에서 가입·이메일 인증 후) 지정
insert into public.app_admins(user_id,role) select id,'admin' from auth.users where email='<운영자 이메일>' on conflict(user_id) do update set role='admin';
```

### 6-2. 직접(SQL 편집기와 CLI)

SQL 편집기에서 위 1~3을 순서대로, 함수는 `npx supabase functions deploy <이름> --project-ref refwrdfxbhcsguweicle --use-api
--no-verify-jwt`(네 함수 모두 `verify_jwt` 끔: 각 함수가 사용자 토큰이나 예약 비밀값을 직접 확인하고, 새 `sb_publishable_` 키는 JWT가
아님), 비밀값은 `npx supabase secrets set`, 예약은 Vault 비밀을 만든 뒤 `install-platform-cron.sql`. Auth 설정은 대시보드에서
6-1의 2번과 같게.

로컬에서 실제 서버로 시험하기(개발자): `supabase start` 뒤 위 SQL을 적용하고 함수를 `supabase functions serve`로 띄운 다음
`scripts/platform-e2e.mjs`(환경 변수는 파일 머리말)와 `AOL_REAL_*`를 준 `qa/real-backend.spec.mjs`. 로컬 백엔드는 다른 포트의
루프백 주소라 Chromium의 Local Network Access 검사를 끄는 실행 옵션이 필요하고(시험 파일에 있음), 사이트의 CSP는
`https://*.supabase.co`만 허용하므로 시험이 자기 페이지에서만 넓힙니다(빌드는 그대로).

## 7. 비용과 유지관리 (추정, 공식 가격표로 확인 필요)

| 항목 | 선택 | 월 비용 |
|---|---|---|
| Supabase | Free(500MB DB, 월 5만 MAU, 7일 무활동 시 일시 중지) / Pro(월 $25, 8GB DB, 월 10만 MAU) | $0 / 약 $25 |
| 인증 메일 SMTP | 예: Resend 무료(월 3,000통, 하루 100통) / 유료 약 $20 | $0~$20 |
| 문맥 검수(선택) | 기본 `claude-opus-5-5`($4/$20 per 1M 토큰) 항목당 약 $0.01~0.02 · `claude-sonnet-5-5`($2/$10) 약 절반 · `claude-haiku-5-5`($0.10/$0.50, 10만 토큰 이하 요청) 항목당 약 $0.0005 | 월 1,000건 기준 약 $10~20 / $5~10 / 약 $0.5 |
| GitHub Pages·Actions | 공개 저장소 | $0 |
| 도메인(선택) | 인증 메일 발신 도메인 | 연 1~2만 원대(운영자 결정) |

가격은 Anthropic 공개 가격표(2026-11-03 기준 사본)로 확인했습니다. 항목당 비용은 시스템 지시문(약 1,500토큰)과 글, 짧은 JSON 답을
가정한 추정이며 실제 요금은 콘솔의 사용량으로 확인하세요. 모델은 함수 비밀값 `MODERATION_MODEL`로 바꿉니다. Opus·Sonnet은 거절 시
서버 측 대체 모델(fallbacks)을 쓰고, Haiku에는 그 기능이 없어 거절된 항목은 사람 검토로 갑니다. 검수 API로 보내는 것은 글의 종류·
제목·본문과 장소 이름뿐이며 회원 ID·이메일은 보내지 않습니다. 보관 기간과 학습 사용 여부는 Anthropic 상업 이용약관과 운영자 조직의
데이터 보관 설정을 따르므로 **키를 만들기 전에 운영자가 약관에서 확인**해야 합니다(이 저장소에서 확인하지 못함). API 키와 유료 사용은
운영자 승인 뒤에만 연결합니다. 키가 없어도 규칙 검사와 사람 검토로 모든 기능이 동작합니다.

유지관리: 검수 대기열(사진은 전부 사람), 연구자 신청 검토, 신고·이의신청 처리, 월 1회 감사 로그 확인, 분기 1회 보안 점검과
백업 복원 시험(Pro 플랜은 매일 백업), 이용조건 바뀔 때 `research_terms_version` 올리기.

## 8. 정책 문서

초안: `docs/policies/v2-drafts.md`. **아직 게시하지 않았고 법적 검토가 필요합니다.** 지금 사이트의 개인정보 처리방침·이용 안내는
회원 기능이 없는 v1.0 기준이며, 회원 기능을 켜는 날 함께 바꿔야 합니다.

## 9. 검증 상태

로컬 실제 스택: 이 컨테이너의 Supabase CLI 2.122.1 로컬 스택(Postgres 17, GoTrue Auth와 메일 수신기, PostgREST, Storage, Edge Runtime).
**운영 프로젝트(`refwrdfxbhcsguweicle`)에는 아직 적용하지 않았습니다**: 이 개발 환경은 `*.supabase.co`와 `api.supabase.com`에 접속할 수
없어서, 적용과 실제 점검은 6-1의 workflow를 운영자가 실행해야 합니다.

| 항목 | 상태 |
|---|---|
| SQL 설치 순서(v0.15 일부 적용 상태 → complete-backend → platform-v2, 두 번씩) | 검증 완료(로컬 실제 스택) · 운영 프로젝트 미적용 |
| 가입·인증 메일 링크·로그인·로그아웃·비밀번호 재설정 | 검증 완료(로컬, 실제 메일 수신기의 인증 메일 링크) · 운영 프로젝트는 SMTP 연결 필요 |
| 권한·RLS·역할 위조 거부·운영자 2단계 인증(TOTP)·프로필 문구 규칙 | 검증 완료(로컬 실제 Auth·PostgREST, `scripts/platform-e2e.mjs`) · 마지막 admin 보호는 SQL 시험(PGlite)만: 실제 프로젝트에서는 운영자 계정에 닿을 수 있어 돌리지 않음 |
| 후기·댓글·좋아요·자기 글·댓글 수정·삭제·신고·이의신청·자동 검수(규칙)·운영자 승인·공개 보기 | 검증 완료(로컬) |
| 사진 비공개 업로드·EXIF 제거·등급 필수·중복 거부·게시 중단·회원의 사진 거두기 | 검증 완료(로컬 실제 Storage와 함수) |
| 연구자 신청·승인 전 거절·승인 후 120초 서명 URL·다른 회원 거절·비공개 버킷·권한 취소 즉시 거절·기록 | 검증 완료(로컬) |
| 계정 삭제(글·사진 함께 삭제) | 검증 완료(로컬) |
| 운영자 회원 목록(감사 로그 기록)·연구 권한 목록·다운로드 기록, 회원에게는 거절 | 검증 완료(로컬) |
| 휴대전화(390px)·데스크톱(1440px) 브라우저 통합(가입→인증 메일→로그인→후기→자동 검수→콘솔 TOTP 등록→승인→공개) | 검증 완료(로컬, `qa/real-backend.spec.mjs`, 5회 연속 통과) |
| 예약 작업(pg_cron → Vault 비밀 → moderate-queue) | 검증 완료(로컬, 예약 명령을 직접 실행해 200 응답) · 실제 5분 주기 관찰은 운영 프로젝트에서 |
| 화면(서버 없음·가짜 서버) | 테스트 완료(Playwright, `qa/v2-platform.spec.mjs`, `qa/admin.spec.mjs`) |
| 문맥 분류기(Claude API) | 미검증(API 키 없음, 운영자 승인 필요) · 요청 형식은 현재 API 규칙으로 단위 테스트 |
| 운영 프로젝트 설치·점검 workflow | 구현 완료·검증 필요(Management API 호출은 대체 서버로 단위 테스트, SQL 경로는 로컬 실제 스택. 첫 `inspect` 실행이 실제 확인) |
| 실제 이메일 발송(SMTP) | 운영 환경 설정 필요 |
| 장기 안정성(예약 실행, 대기열, 비용) | 운영 후 일정 기간 관찰 필요(시험만으로 검증 완료라 하지 않음) |
