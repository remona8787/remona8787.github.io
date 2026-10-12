# Live Data Edge Functions

- `sync-korea-open-data`: 한국관광공사 TourAPI + 서울 열린데이터광장
- `refresh-live-place`: Google Places / Foursquare 단일 장소 실시간 보강
- `sync-wikidata`: 전세계 장소 식별·기초정보
- `sync-ticketmaster`: 글로벌 이벤트 후보

## 원칙
- 빛의 건축 편집 DB가 canonical.
- Google/Mapbox 등 제한이 있는 provider 콘텐츠는 TTL/요청시 조회.
- provider ID는 장기 저장 가능 여부를 약관별로 확인.
- 외부 변화는 `editorial_review_queue`로 보내고 전문가 해설은 자동 덮어쓰기 금지.
- 사진은 `media_assets.clearance_status='cleared'`인 것만 앱에 렌더.
