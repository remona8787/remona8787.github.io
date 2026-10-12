# v0.9 적용 순서

1. 기존 v0.8까지 SQL 실행
2. `10_global_discovery_engine.sql` 실행
3. `11_global_discovery_cron.sql`는 Edge Function 배포 후 실행
4. sample countries / cities를 참고해 `countries`, `cities`에 초기값 입력
5. Edge Functions 배포
   - `discover-city-candidates`
   - `promote-candidate`
6. 수동 테스트
   - `discover-city-candidates` with `{"city_code":"SEOUL","limit_cities":1,"candidate_limit_per_city":60}`
7. `global_candidates_admin` 뷰에서 후보 확인
8. 좋은 후보를 `promote-candidate`로 `places`에 승격
9. 필요 시 기존 v0.8 media sync로 이미지 캐시 연결

## 권장 운영 방식
- 전세계 전체를 한 번에 긁지 말고 `cities.discovery_priority` 기준으로 순차 확장
- city 단위 job으로 분할
- score 기준으로 review queue를 운영
- `published`만 앱에 반영
