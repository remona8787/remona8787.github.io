# v0.9 Global Discovery Engine

## 목적
서울 curated seed 50개를 넘어, 국가 → 도시 → 장소 후보를 자동 수집하는 레이어를 추가합니다.

## 핵심 테이블
- `countries`
- `cities`
- `ingestion_jobs`
- `external_candidates`
- `provider_links`
- `duplicate_clusters`
- `candidate_scores`

## 후보 라이프사이클
`discovered → matched → scored → reviewed → published`

## publishing_status
- `draft`
- `ready`
- `published`
- `hidden`
- `rejected`

## 자동 탐색 흐름
1. `cities`의 bbox / wikidata_id를 읽음
2. Overpass API에서 museum / gallery / arts_centre / keyword 기반 후보 수집
3. Wikidata에서 문화 / 건축 관련 후보 추가 수집
4. 이름 + 좌표 기반 dedupe
5. relevance / confidence scoring
6. `external_candidates` + `provider_links`에 upsert
7. duplicate cluster assign
8. 일정 점수 이상 후보는 `publishing_status = ready`
9. 필요 시 `promote-candidate` 함수로 canonical `places`로 승격

## 확장 포인트
- Foursquare Places API 연결
- Google Places live overlay 연결
- Ticketmaster / 도시별 문화행사 API 연결
- 장소별 media sync 자동 트리거
- 관리자 대시보드에서 candidate review

## 현재 구현 범위
- DB schema
- dedupe / scoring structure
- `discover-city-candidates` Edge Function
- `promote-candidate` Edge Function
- cron job template
- sample seed countries/cities
