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

1. Supabase 프로젝트 만들기(지역: 서울 `ap-northeast-2` 권장). 무료 플랜은 7일 동안 활동이 없으면 일시 중지되므로
   실제 운영은 Pro 플랜을 권장합니다(7절 비용).
2. SQL 편집기에서 `supabase/migrations/`의 파일을 날짜 순서대로 실행(20261010 → 20261013 → 20261018 → 20261026 → 20261112).
3. Authentication → Providers → Email: "Confirm email" 켜기, 비밀번호 최소 길이 12, 유출 비밀번호 차단(가능하면).
   Authentication → SMTP: 자체 SMTP 연결(Supabase 기본 발송은 운영용이 아님). 링크 추적은 꺼야 인증 링크가 깨지지 않습니다.
   자체 도메인이 있어야 발송 신뢰도가 확보되는 경우가 많습니다(도메인 구매는 운영자 결정).
4. Authentication → MFA: TOTP 켜기. 운영자 계정에 MFA 등록 후 `app_admins`에 admin으로 등록(SQL, 아래).
5. Edge Functions 배포(`research-download`, `publish-photo`, `moderate-queue`, `delete-account`)와 비밀값 설정:
   `MODERATION_CRON_SECRET`(긴 무작위 값), 선택 `ANTHROPIC_API_KEY`, `MODERATION_MODEL`, `ALLOWED_ORIGINS=https://remona8787.github.io`.
   비밀값은 Supabase의 함수 비밀값(Secrets)에만 둡니다. 저장소·`config.js`에 넣지 않습니다.
6. pg_cron: 5분마다 `moderate-queue` 호출(헤더 `x-aol-cron-secret`), 하루 한 번 `select public.platform_expire()`.
7. 법적 문서(8절) 검토와 게시. 개인정보 처리방침에 국외 이전(Supabase·이메일 발송·검수 API) 항목을 넣어야 합니다.
8. 보안 점검: Supabase Advisors(보안·성능) 확인, 이 저장소의 `tests/platform-sql.test.mjs` 시나리오를 실제 프로젝트에서 다시 확인,
   운영자 MFA 없이 관리 함수가 막히는지 확인.
9. 마지막으로 `site-public-cleared/config.js`에 `SUPABASE_URL`과 공개용 `SUPABASE_PUBLISHABLE_KEY`(서비스 키 아님)를 넣고 배포.

```sql
-- 운영자 계정(Authentication에서 가입·MFA 등록 후) 지정
insert into public.app_admins(user_id,role) select id,'admin' from auth.users where email='<운영자 이메일>' on conflict(user_id) do update set role='admin';
```

## 7. 비용과 유지관리 (추정, 공식 가격표로 확인 필요)

| 항목 | 선택 | 월 비용 |
|---|---|---|
| Supabase | Free(500MB DB, 월 5만 MAU, 7일 무활동 시 일시 중지) / Pro(월 $25, 8GB DB, 월 10만 MAU) | $0 / 약 $25 |
| 인증 메일 SMTP | 예: Resend 무료(월 3,000통, 하루 100통) / 유료 약 $20 | $0~$20 |
| 문맥 검수(선택) | Claude Opus 5.5($4/$20 per 1M 토큰) 항목당 약 $0.01~0.02 · Claude Haiku 5.5($0.10/$0.50) 항목당 약 $0.0005 | 월 1,000건 기준 약 $10~20 / 약 $0.5 |
| GitHub Pages·Actions | 공개 저장소 | $0 |
| 도메인(선택) | 인증 메일 발신 도메인 | 연 1~2만 원대(운영자 결정) |

유지관리: 검수 대기열(사진은 전부 사람), 연구자 신청 검토, 신고·이의신청 처리, 월 1회 감사 로그 확인, 분기 1회 보안 점검과
백업 복원 시험(Pro 플랜은 매일 백업), 이용조건 바뀔 때 `research_terms_version` 올리기.

## 8. 정책 문서

초안: `docs/policies/v2-drafts.md`. **아직 게시하지 않았고 법적 검토가 필요합니다.** 지금 사이트의 개인정보 처리방침·이용 안내는
회원 기능이 없는 v1.0 기준이며, 회원 기능을 켜는 날 함께 바꿔야 합니다.

## 9. 검증 상태

| 항목 | 상태 |
|---|---|
| 권한·상태 전이·RLS·관리자 함수 | 테스트 완료 (PGlite, `tests/platform-sql.test.mjs` 12개 시나리오) · 실제 Supabase에서는 미검증 |
| 사진 검사·메타데이터 제거 | 테스트 완료 (실제 JPEG·PNG·WebP, `tests/platform-functions.test.mjs`) · Edge Function 실행은 미검증 |
| 자동 검수 규칙 | 테스트 완료 (평가 세트) · 문맥 분류기 미검증 (API 키 필요) |
| 연구용 패키지 | 테스트 완료 (4개 형식, openpyxl 읽기, 체크섬, 결정성) · 비공개 버킷 업로드 운영자 설정 필요 |
| 화면 | 테스트 완료 (Playwright, 서버 없음/가짜 서버 두 경우, `qa/v2-platform.spec.mjs`) · 실제 서버 연결 미검증 |
| 가입·인증 메일·MFA·서명 URL·계정 삭제 | 운영자 설정 필요 (Supabase 프로젝트 없음) · 미검증 |
