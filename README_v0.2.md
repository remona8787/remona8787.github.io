# 빛의 건축 v0.2 — Live Ready

이번 버전에서 추가:
- 서울 Seed 50곳 전수 감사
- 주소/운영상태/프로그램/출처별 상태값
- 이미지 권리 획득 전략 50행
- 전국·전세계 Live Data Architecture
- Supabase live-data schema
- provider external ID / TTL snapshot / events / provenance / media rights / review queue
- TourAPI·서울 OpenAPI·Wikidata·Google/Foursquare·Ticketmaster adapter scaffold
- 서울/전국/세계 모드가 들어간 v0.2 클릭 프로토타입

## 가장 먼저 열기
`prototype/single_file_prototype_v0.2.html`

## 중요한 상태
- KEEP: 24
- KEEP_WITH_WARNING: 23
- KEEP_NOT_NOW / UPCOMING: 2
- HOLD: 1
- 이미지: 자산 단위 라이선스 확인 전 0건 cleared

## 계정 후 실행 SQL 순서
v0.1의 01~04
→ `05_live_data_schema.sql`
→ `06_cron_templates.sql` 참고
→ `07_audited_corrections.sql`

## Live expansion
한국: TourAPI + 서울/지자체 OpenAPI
글로벌 canonical enrichment: Wikidata + OSM
실시간 overlay: Google Places / Foursquare
이벤트: Ticketmaster + 공공 행사 API
미디어: Wikimedia / Europeana / TourAPI / 직접허가·직접촬영
