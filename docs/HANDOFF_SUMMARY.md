# Handoff Summary — 빛의 건축 v0.1

## 현재 완성된 것
- 실제 서울 Seed 장소 50개
- 6개 큐레이션
- 클릭 가능한 모바일 프로토타입
- Supabase DB / RLS / Auth companion schema
- Seed SQL
- Storage policy
- FlutterFlow helper RPC
- FlutterFlow 화면·액션·상태 명세
- QA 테스트 케이스
- 개인정보/스토어/런칭 준비문서
- MVP Implementation Tracker
- 모바일용 앱 제작 가이드 PDF

## 지금 즉시 열어볼 것
`prototype/single_file_prototype.html`

이 프로토타입은 백엔드 없이:
- 검색
- Home
- Map placeholder + 실제 주소 지도검색
- Place Detail
- Curation
- 저장
- 방문 기록
- My Light Map 통계
를 사용할 수 있다.

저장과 방문 기록은 브라우저 localStorage에만 저장한다.

## 계정을 만들었을 때 최초 작업
Supabase:
1. 01_schema.sql
2. 02_seed_seoul50.sql
3. 03_storage.sql
4. 04_flutterflow_rpc.sql
5. 98_data_audit.sql
6. 99_smoke_tests.sql

FlutterFlow:
1. Supabase OAuth
2. Get Schema
3. Click_By_Click_Manual.md 순서로 조립

## 현재 실제 제품화를 막는 외부 Gate
- Supabase project
- FlutterFlow project
- Google Maps API key
- 정확한 geocoding
- 이미지 사용권
- 앱스토어 개발자 계정

나머지 설계 산출물은 본 패키지에 준비되어 있다.
