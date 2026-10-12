# 정보구조 참고와 적용 범위
확인일: 2026-10-11 KST. 아래 실제 URL을 웹 검색 도구로 열어 공개 HTML의 메뉴·목록·본문을 확인했습니다. 로그인 내부 기능과 실제 모바일 상호작용은 검증하지 않았습니다.

- https://popga.co.kr/ — 사진 기반 추천과 카테고리, 탐색·계획·방문 흐름, 5개 핵심 내비게이션.
- https://popga.co.kr/list/recommended — 방문 가능/테마/지역/주간·월간 구분.
- https://popga.co.kr/popup/9073 — 상세의 위치, 일정, 방문 안내, 출처/공유/저장 연결. 해당 콘텐츠 자체는 복제하지 않음.
- https://popply.co.kr/ — 검색·관심·주변·캘린더·마이 연결.
- https://popply.co.kr/popup — 간단한 검색과 날짜/지역/상태 필터.
- https://popply.co.kr/maps — 지도 검색과 목록 보기 경로.
- https://popply.co.kr/popupcalendar — 개인 캘린더 진입 경로.

빛의 건축에서는 추천 인기 순위를 만들지 않고 수록 우선순위를 명시했습니다. 운영이 확인된 데이터가 없으면 지금 방문 섹션을 숨깁니다. 국가·도시 필터는 실제 수록 데이터에서 생성하며, 메타데이터가 없는 정렬과 필터는 비활성화합니다. 전문 기술정보는 상세 내부에 접어 배치합니다.

Supabase 변경/보안 참고:
- https://supabase.com/changelog.md (직접 다운로드 성공)
- https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically — 신규 테이블에 명시적 GRANT 필요.
- https://supabase.com/docs/guides/storage/security/access-control — storage.objects RLS와 소유자 접근.
- https://supabase.com/docs/reference/javascript/storage-from-createsignedurl — 비공개 파일 만료 링크.
- https://supabase.com/docs/reference/javascript/storage-from-upload — 업로드 API.
