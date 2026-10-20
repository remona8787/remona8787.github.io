# 최신 버전: v0.17.0

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
