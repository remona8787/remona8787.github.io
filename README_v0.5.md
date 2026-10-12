# 빛의 건축 v0.5 — Image Sync Fix

v0.4에서 이미지가 보이지 않는 문제를 수정한 버전.

핵심 변경:
- P18 only → 3-stage fallback
- Wikidata P18
- Wikimedia Commons Category(P373)
- Wikimedia Commons direct search
- 장소명 fuzzy scoring
- 파일별 라이선스 검증 유지
- 카드/상세 이미지 상태 표시
- 3일 자동 재검색
- MY에서 캐시 강제 갱신

주의:
검색 결과가 있어도 재사용 가능한 라이선스가 없으면 placeholder를 유지한다.
