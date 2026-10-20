# Live Data Edge Functions

- `sync-korea-open-data`: 한국관광공사 TourAPI + 서울 열린데이터광장
- `refresh-live-place`: Google Places / Foursquare 단일 장소 실시간 보강
- `sync-wikidata`: 전세계 장소 식별·기초정보
- `sync-ticketmaster`: 글로벌 이벤트 후보
- `sync-global-places`: 전국·세계 빛 장소를 Wikidata 갈래 조회로 6시간마다 한 번(`{"phase": "places"}`), 대표 사진의 Commons 권리 확인을 3시간마다(`{"phase": "images"}`) 실행해 `discovered_places`에 저장. 두 단계는 잠금 하나를 함께 쓰고, 한 번 실행은 130초 안에 끝남. 앱은 `public_discovered_places` 보기로 읽음(`release/launch/LAUNCH.md` 7단계)

## 원칙
- 빛의 건축 편집 DB가 canonical.
- Google/Mapbox 등 제한이 있는 provider 콘텐츠는 TTL/요청시 조회.
- provider ID는 장기 저장 가능 여부를 약관별로 확인.
- 외부 변화는 `editorial_review_queue`로 보내고 전문가 해설은 자동 덮어쓰기 금지.
- 사진은 `media_assets.clearance_status='cleared'`인 것만 앱에 렌더.

## 미디어파사드 아카이브 (v0.16, docs/ARCHIVE_COLLECTOR.md)
- `archive-collect`: 매시 17분 pg_cron이 `x-aol-cron-secret` 헤더에 `MEDIA_CRON_SECRET`을 실어 호출(별도 아카이브 비밀값 없음). 마감된 규칙을 최대 6개 가져와 수집 → 분류 → `archive_ingest`. 편집자는 관리 콘솔에서 자기 세션으로 규칙을 지정해 실행
- `archive-check-links`: 하루 한 번, `MEDIA_CRON_SECRET`만 허용. 출처·공식 사이트·이미지 링크 상태 기록
- `archive-websub`: 공개 주소(허브가 호출). 구독 비밀값으로 HMAC 서명을 확인한 푸시만 수집
