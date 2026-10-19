# 빛의 건축 아카이브 운영 콘솔

미디어파사드 아카이브(docs/ARCHIVE_SPEC.md)의 검수·편집·수집 운영 화면입니다. 화면별 설명, 역할 부여 SQL,
편집자 검수 기준, 콘솔이 보내는 RPC는 `docs/ARCHIVE_ADMIN.md`에 있어요.

## 화면
- 대시보드: 대기열·실행·오류·출처·프로젝트 현황, 최근 실행, 지금 수집 실행(관리자)
- 검수 대기열: 필터, 상세(기사·분류 근거·감지 위치·비슷한 프로젝트), 승인·연결·병합·반려·무시·다시 열기, j/k 단축키
- 프로젝트: 모든 아카이브 항목 편집과 항목별 확인 상태, 크레딧·출처·미디어, 공개 상태, 합치기
- 변경 감지, 수집 작업(실행·오류·규칙 상태·다시 시도), 수집 규칙·키워드(관리자만 수정), 설정(관리자)
- 연구자 평가, 매거진, 장소 후보(v0.10 도구)

## 역할
`app_admins.role`의 `admin`·`editor`·`researcher`를 `archive_role()`로 확인해요. 역할이 없으면 로그아웃돼요.
화면은 역할에 맞춰 버튼을 숨길 뿐이고, 실제 권한은 데이터베이스 함수가 검사합니다.

## 보안
- 브라우저에는 `config.js`의 SUPABASE_URL과 publishable key만 둡니다. service role 키, API 키,
  MEDIA_ADMIN_SECRET은 절대 넣지 않습니다.
- 데이터베이스에서 온 문자열은 모두 이스케이프하고, 링크는 http·https만 엽니다(`rel="noopener noreferrer"`).
- 지금 수집 실행과 장소 발견 버튼은 로그인한 사용자의 JWT로 Edge Function을 부르고, 함수가 역할을 다시 확인해요.

## 설정
`config.js`에 SUPABASE_URL과 SUPABASE_PUBLISHABLE_KEY를 넣고, 로그인할 계정에 역할을 한 번 부여하세요
(`docs/ARCHIVE_ADMIN.md`의 "역할 부여").

`admin/`과 `site-public-cleared/admin/`은 같은 파일이어야 해요(`npm run check`가 비교합니다).
