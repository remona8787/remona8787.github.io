# 서울·도쿄·뉴욕 Bootstrap 실행

## 0. 선행조건
Supabase에 SQL 01~14가 적용되어 있어야 합니다.
Edge Functions:
- discover-city-candidates
- promote-candidate
- admin-discovery-command

Secrets:
- server-side Supabase secret key
- MEDIA_ADMIN_SECRET
- MEDIA_CRON_SECRET

## 1. 초기 데이터
`supabase/12_seed_countries_cities.sql` 실행.

## 2. Windows
PowerShell:
`./run_bootstrap_discovery.ps1`

스크립트가 Supabase URL과 `MEDIA_ADMIN_SECRET`을 로컬에서만 물어봅니다.
비밀키를 ChatGPT 대화나 웹 클라이언트 코드에 넣지 마세요.

## 3. macOS/Linux
`chmod +x run_bootstrap_discovery.sh`
`./run_bootstrap_discovery.sh`

## 4. 기대 결과
`external_candidates`에 도시별 후보가 쌓이고
`candidate_scores`, `provider_links`, `duplicate_clusters`, `ingestion_jobs`가 채워집니다.

## 5. 검토
관리자 콘솔에서:
- Ready
- Reviewed
- Reject
- Hide
- Promote to Place
를 사용합니다.
