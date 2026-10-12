# 빛의 건축 v0.4 — Auto Image Sync

추가된 실제 기능:
- Seed 장소 카드/리스트/상세 Hero의 이미지 자동 동기화
- Wikidata exact-ish 장소 매칭
- P18 → Wikimedia Commons 파일 추적
- Commons 파일별 라이선스/저작자 extmetadata 검증
- 허용 라이선스만 이미지 표시
- 모든 자동 이미지 하단에 `저작자 · 라이선스` 표시 + 원본 파일 링크
- 라이선스 불명/NC/ND는 자동 미사용
- 7일 cache TTL + MY의 강제 갱신 버튼
- 서울문화행사 OpenAPI 자동 sync Edge Function scaffold

현재 자동:
- 이미지: 7일 갱신
- 글로벌 검색: 실시간
- 글로벌 좌표: 실시간 Wikidata
- 지도: 실시간 OSM

키 연결 후 자동:
- 서울 문화행사/프로그램
- TourAPI 전국 행사/장소/이미지
