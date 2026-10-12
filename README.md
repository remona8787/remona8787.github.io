# 최신 버전: v0.14

- 출시 순서: [release/launch/LAUNCH.md](release/launch/LAUNCH.md)
- 이번 변경·검증: [release/STATUS_v0.14.md](release/STATUS_v0.14.md)
- 소스: `site-public-cleared/` → `npm run build` → 배포 대상 `dist/`
- 검증: `npm test` (단위 + SQL/RLS), `npm run e2e` (실제 브라우저), `node scripts/launch-check.mjs`

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
