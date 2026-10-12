# v0.10 실행 순서

## A. DB
신규 프로젝트라면:
01 → 02 → 03 → 04 → 05 → 06 → 07 → 08 → 09 → 10 → 12 → 13 → 14

이미 v0.9까지 적용했다면:
12 → 15 → 13 → 14

`11_global_discovery_cron.sql`은 Edge Functions 배포 및 Vault secret 설정 후 실행합니다.
`16_bootstrap_admin_smoke_tests.sql`은 마지막 점검용입니다.

## B. Edge Functions
배포:
- discover-city-candidates
- promote-candidate
- admin-discovery-command
- v0.8 media functions

필수 server secrets:
- Supabase server-side secret key
- MEDIA_ADMIN_SECRET
- MEDIA_CRON_SECRET

## C. Admin user
1. Supabase Auth에서 본인 이메일 계정 생성
2. SQL Editor에서 `app_admins` 등록
3. `admin/config.js`에 URL + publishable key만 기입
4. 관리자 콘솔 로그인

## D. Bootstrap
관리자 콘솔에서 서울 → 도쿄 → 뉴욕 순으로 Discovery 버튼을 눌러도 되고,
`bootstrap/run_bootstrap_discovery.ps1`을 실행해도 됩니다.

## E. 후보 검토
- ready: 검토 우선순위
- reviewed: 사람 검토 완료
- reject: 제외
- hide: 임시 숨김
- Promote → Place: canonical `places` 생성
- 승격된 place는 기본 `is_published=false`; 공개 전 편집 보강

## F. 이미지
승격한 place에는 v0.8 `sync-place-media`를 실행해
Commons 후보 → Storage cache → rights refresh 파이프라인을 연결합니다.
