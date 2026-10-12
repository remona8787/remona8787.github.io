# v0.5 Image Sync Fix

v0.4에서 이미지가 거의 표시되지 않은 원인은:
- Wikidata entity matching이 과도하게 엄격
- 대표이미지 P18 한 경로에 의존
- P18이 없는 장소의 fallback 부족

v0.5 탐색 순서:
1. Wikidata entity fuzzy/exact-ish scoring
2. P18 대표이미지
3. P373 Wikimedia Commons Category
4. Wikimedia Commons direct file search (Korean/English place name)
5. 각 후보의 imageinfo/extmetadata로 라이선스 확인
6. CC BY / CC BY-SA / CC0 / Public Domain 후보만 표시
7. NC / ND / Unknown은 사용하지 않음

이미지 하단:
`creator · license` + exact Commons file link

TTL:
3일. MY에서 강제 재검색 가능.

각 이미지 영역 우측 상단에는:
- 이미지 찾는 중
- Wikidata P18
- Commons category
- Commons search
- 이미지 없음
- 이미지 로드 실패
상태가 표시되어 디버깅 가능.
