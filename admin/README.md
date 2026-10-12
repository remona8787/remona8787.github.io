# Global Discovery Admin Console

## 기능
- Supabase Auth 로그인
- candidate KPI
- 도시 / 상태 / 점수 / 검색 필터
- 후보 상세 검토
- Ready / Reviewed / Reject / Hide
- Candidate → canonical Place 승격
- 서울 / 도쿄 / 뉴욕 discovery 버튼 실행
- ingestion job 모니터링

## 보안
브라우저에는 publishable key만 둡니다.
service role / secret key / MEDIA_ADMIN_SECRET은 브라우저에 넣지 않습니다.

Discovery 버튼은:
Admin browser → authenticated JWT → `admin-discovery-command`
→ 서버에서 app_admins 확인 → 내부 discover function 호출

## 설정
`config.js`:
- SUPABASE_URL
- SUPABASE_PUBLISHABLE_KEY

그리고 SQL Editor에서 로그인 계정을 `app_admins`에 1회 등록하세요.
