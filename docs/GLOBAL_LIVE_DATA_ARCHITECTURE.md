# 전국·전세계 Live Data Architecture

## 결론
50개를 버리고 외부 지도 DB 하나에 의존하는 구조가 아니라,
**빛의 건축 Editorial DB + Open Data Sync + Live POI Overlay + Event Feeds + Cleared Media**의 5계층으로 확장한다.

## 1. Editorial Canonical
우리 자체 장소 ID, 사례설명, `why_it_matters`, 전문가 해설, 카테고리, 큐레이션.
이 데이터는 서비스 차별점이며 외부 API가 덮어쓰지 않는다.

## 2. 한국 자동 확장
- 한국관광공사 TourAPI: 전국 관광정보, 위치/키워드/행사/이미지/동기화 목록.
- 서울 열린데이터광장: 서울 문화행사·문화공간 OpenAPI.
- 이후 지자체 OpenAPI는 도시별 adapter로 추가.

## 3. 글로벌 기초 지식
- Wikidata: QID, 좌표, 건축가, 개관연도, 공식사이트 등 구조화 보강.
- OpenStreetMap: 지리기반. ODbL 출처·파생DB 의무를 검토.
- public Nominatim은 production bulk/autocomplete 용도로 쓰지 않는다.

## 4. Live POI Overlay
- Google Places: place ID를 장기 식별자로 저장하고, open_now/영업시간/상태 같은 live field는 약관에 맞춰 실시간/TTL 조회.
- Foursquare: 글로벌 POI 대안.
- Mapbox Search: 검색 UX 후보. Search Box는 temporary-use 제한이 있으므로 canonical DB로 복사하지 않는다.

## 5. Events
- TourAPI 행사
- 서울 문화행사 API
- Ticketmaster Discovery
- 향후 각 미술관/기관 ICS/RSS/API
새 이벤트는 기본 `is_published=false`; 키워드+에디터 필터로 빛/미디어/몰입/야간건축 적합성 판정.

## 6. Images
- 운영사 직접 허가/프레스킷
- TourAPI 제공 이미지
- Wikimedia Commons 파일별 CC/PD
- Europeana/IIIF 권리 상태
- 직접 촬영
정확한 자산 단위 license/attribution이 기록되기 전에는 앱에서 사용하지 않는다.

## 7. 자동 갱신 주기 예시
- 서울 문화행사: 2시간
- TourAPI 행사·동기화: 6시간
- 글로벌 이벤트: 1~6시간
- Google/Foursquare live details: 사용자 요청 시 또는 12~24시간 TTL
- Wikidata: 주 1회
- 이미지 권리: 수동 승인
