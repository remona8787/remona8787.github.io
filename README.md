# 최신 버전: v0.25.0

- v0.25 (2026-11-10): 모바일 중심 전면 재디자인 "Afterglow". 휴대폰에서 글씨가 깨져 보이던 원인 다섯 가지를 고쳤습니다:
  사진 없는 카드의 잘린 큰 글자(모노그램), 자간을 벌린 한글 라벨, 'CC BY-' / 'SA 2.0'처럼 끊기던 라이선스, 뒤 글자가 비치던
  반투명 탭바, 홈의 빈 띠. 홈 상단은 오로라가 흐르는 밤 무대와 스와이프 사진 카드, 주제는 벤토 타일, 대표 작품은 전체 폭의
  밤 띠, 사진 없는 작품은 유형별 색의 오로라와 유형 칩. 휴대폰 탭바는 떠 있는 유리 막대. 모션은 진입(첫 화면·화면 전환·탭)만
  시간 기반이고 나머지는 스크롤에 묶여(animation-timeline) 읽는 사람이 움직일 때만 움직이며, 투명도는 쓰지 않아(이동·확대만)
  스크린숏과 접근성 검사는 항상 최종 색을 봅니다. 움직임 줄이기 설정에서는 모두 꺼집니다. 규칙은 `styles.css` 맨 끝의
  v0.25 "Afterglow" 블록.

- v0.24 (2026-11-10): 전반 디자인 개편. 미술관 소장품 사이트(MoMA·Cooper Hewitt·Rijksmuseum)의 흰 바탕·잉크색 글자·가는 선·사진
  우선 카드, Google Arts & Culture의 어두운 사진 띠, Airbnb의 검색·필터 칩, Apple의 큰 제목을 참고한 패턴(복제가 아님). 큰 화면은
  가로 메뉴, 주요 버튼은 잉크색 알약, 나머지는 테두리. 색 토큰은 `styles.css` 맨 위(대비는 `tests/contrast.test.cjs`가 확인),
  컴포넌트 규칙은 맨 끝의 v0.24 design layer.

- v0.23 (2026-11-10): v0.22.1(2026-11-01, 별도 배포본 https://light-architecture-jihyun.guma.chatgpt.site 에서 진행된 작업)을
  이 저장소에 합쳤습니다. 작품 사진 정책(`site-public-cleared/art-photo-policy.js`: 권리·크기·대상·시각 근거를 모두 갖춘
  작품 사진만 카드·배너·지역 타일에), 검색 조건을 담은 링크(`search-state.js`), 결과가 없을 때 조건 완화 안내, 홈 주제
  바로가기와 세계 사례 앞쪽 배치, 한국 시각 데이터 기준 시각, 업데이트 내역(`updates.html`). 수집기는 index.json에 작품
  사진만 썸네일로 싣고(`representative_policy: artwork_only`) 위치 정밀도와 build_id를 함께 씁니다. 0.22.1 이후 이
  저장소의 작업(수집 중단·Wikidata 지연 시 직전 데이터 유지, 관리자 규칙 입력 유지, 확인 서버 고정)은 그대로이고, 메인
  배너는 요청대로 한국 사례만 씁니다.

- v0.19 (2026-10-27): 5차 개선. 상세 페이지(이미지 역할, 슬라이드 갤러리, 개요·건축·작품·위치·자료 탭, 자료 없음·확인 필요),
  오류 신고, 공개 연구 데이터 패키지(CSV·JSON·GeoJSON·XLSX, 데이터 사전, 인용, 버전), 회원 연구 데이터와 관리자 통계(서버
  코드, Supabase 연결 전), 수익화 검토(기본 꺼짐). 서비스 워커는 이제 새 배포를 바로 받습니다: 셸과 manifest·home은 네트워크
  우선, 새 워커가 곧바로 넘겨받고, 0.18까지의 캐시 우선 워커가 남은 브라우저는 한 번 새로 고칩니다. 결과 보고:
  [docs/REPORT_v019.md](docs/REPORT_v019.md)

- v0.18 (2026-10-25): 한국 우선 구성(국내 미디어파사드 · 국내 미디어아트·전시 · 지도 · 세계 미디어파사드 · 아카이브 검색 ·
  내 컬렉션), 슬롯보다 작은 사진을 늘리지 않는 사진 규칙, 검색 범위(한국 · 세계 · 전체)와 오타에 너그러운 검색, 지역 안의
  시·군·구, 검색엔진용 정적 프로젝트 페이지(`scripts/prerender.mjs`). 화면 설명: [docs/UI_v018.md](docs/UI_v018.md)

- 공개 주소: https://remona8787.github.io (GitHub Pages). 빌드: `SITE_URL=https://remona8787.github.io npm run build` → `dist/`
  (`SITE_URL`이 없으면 `site-public-cleared/config.js`의 `PUBLIC_URL`을 그대로 씁니다). 배포 방법: [site-public-cleared/DEPLOY.md](site-public-cleared/DEPLOY.md)
- 정적 아카이브(운영 경로, v0.17): [docs/STATIC_ARCHIVE.md](docs/STATIC_ARCHIVE.md) — GitHub Actions 수집 파이프라인과 `/data/*.json` 데이터셋. 명세 단계이며 아직 실제로 실행하지 않았습니다.
- 미디어파사드 아카이브(Supabase 경로, 선택): [docs/ARCHIVE_SPEC.md](docs/ARCHIVE_SPEC.md), DB [docs/ARCHIVE_DB.md](docs/ARCHIVE_DB.md),
  수집기 [docs/ARCHIVE_COLLECTOR.md](docs/ARCHIVE_COLLECTOR.md), 관리 콘솔 [docs/ARCHIVE_ADMIN.md](docs/ARCHIVE_ADMIN.md), 앱 [docs/ARCHIVE_APP.md](docs/ARCHIVE_APP.md).
  네 갈래를 v0.17에서 합쳤고, 녹화된 응답(fixture)과 PGlite로만 검증했습니다(`tests/archive-integration.test.mjs`).
- 진단: [release/DIAGNOSIS_v0.16.md](release/DIAGNOSIS_v0.16.md) · 출시 순서(Supabase): [release/launch/LAUNCH.md](release/launch/LAUNCH.md)
- 소스: `site-public-cleared/` → `npm run build` → 배포 대상 `dist/`
- 검증: `npm test` (단위 + SQL/RLS + 아카이브 통합), `npm run check`, `npm run e2e` (실제 브라우저), `node scripts/launch-check.mjs`

기능 설명은 [README_v0.11.md](README_v0.11.md)를 참고하세요. 아래는 원본 v0.1 문서입니다.

---

# 빛의 건축 v0.1 — Developer Ready Package

현재 상태는 **계정 생성 직전까지 준비된 MVP**다.

## 바로 확인
- `prototype/single_file_prototype.html` — 클릭 가능한 모바일 프로토타입
- `supabase/01_schema.sql` — DB/RLS/Auth schema
- `supabase/02_seed_seoul50.sql` — 서울 50곳 데이터
- `supabase/04_flutterflow_rpc.sql` — 저장/방문/검색/My 통계 helper
- `flutterflow/Click_By_Click_Manual.md` — FlutterFlow 조립 순서
- `qa/QA_Test_Cases.csv` — 테스트 케이스
- `release/Launch_Gate.md` — 출시 전 Gate

## 실제 계정이 생기면
Supabase에서 `01 → 02 → 03 → 04` 순으로 실행하고, 그 뒤 FlutterFlow에서 Get Schema를 한다.

## 아직 의도적으로 비워둔 것
1. 정확한 위·경도 — 추정하지 않음.
2. 장소 이미지 — 권리 확인 전 자동 수집하지 않음.
3. 운영자 정보/문의메일 — 실제 운영 주체 결정 필요.
4. 앱스토어 계정/Signing — 사용자 계정 필요.

## Prototype → Production 교체점
- localStorage saved → `saved_places`
- localStorage visited → `visited_places`
- embedded seed JSON → Supabase backend query
- placeholder map → Google Maps + verified coordinates
- gradient image → Supabase Storage `media`
