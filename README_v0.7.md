# 빛의 건축 v0.7 — Gallery / Candidate Review / Global Promote

추가 구현:
- 장소별 이미지 후보 다중 수집
- 대표 이미지 후보 3개 + 추가 후보 갤러리
- 후보별 적합도 점수
- 잘못 매칭된 이미지 수동 제외 목록(localStorage)
- 전세계/전국 라이브 검색 결과를 서울 Seed처럼 상세페이지로 승격하는 흐름

주요 UX:
1. Seed 장소 상세 → 대표후보 3개 / 추가후보 / 제외 버튼
2. Live 검색 결과 → 상세보기 → 동일한 이미지 후보 갤러리 / 메타데이터
3. MY → rights CSV export / 제외 목록 집계

모드:
- site/: INTERNAL REVIEW (pending 허용)
- site-public-cleared/: PUBLIC SAFE (cleared만 표시)
