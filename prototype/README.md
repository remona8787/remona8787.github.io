# Clickable Prototype

## 가장 쉬운 방법
`single_file_prototype.html`을 휴대폰/PC 브라우저에서 연다.

## 기능
- Home / Map / Place Detail / Curation / Saved / My
- 50개 Seed 장소
- 검색
- 저장/방문(localStorage)
- 6개 큐레이션
- 외부 지도 주소 검색
- 출처/공식 URL

## 제한
- 실제 Google Maps multi-marker는 정확한 lat/lng와 API key가 생긴 뒤 연결.
- 실제 로그인은 Supabase 계정 생성 뒤 연결.
- 장소 사진은 저작권 확인 전 gradient placeholder 사용.

## PWA 테스트
이 폴더를 localhost로 서빙:
`python -m http.server 8080`
그 다음 `http://localhost:8080/prototype/` 접속.
