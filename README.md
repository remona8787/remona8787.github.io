# 빛의 건축 · Architecture of Light

전 세계 미디어파사드와 빛의 건축을 검색·탐색·비교하는 아카이브 웹앱의 **배포본(빌드 결과물)**입니다.

- 공개 주소: https://remona8787.github.io/
- 이 저장소에는 빌드된 정적 파일만 있습니다. 원본 소스는 `light-architecture/` 프로젝트(`npm run build` → `dist/`)에서 만들어집니다.
- GitHub Pages가 `main` 브랜치 루트를 그대로 공개합니다. `.nojekyll`이 있어 모든 파일이 가공 없이 제공됩니다.
- GitHub Pages는 서버 응답 헤더를 바꿀 수 없어서, 콘텐츠 보안 정책(CSP)을 각 HTML의 `<meta http-equiv="Content-Security-Policy">`로 넣었습니다.

## 서버 없이 동작하는 것
편집부 수록 장소, Wikidata 기반 전국·세계 장소 동기화(브라우저에서 6시간마다 갱신), 권리 확인된 Wikimedia Commons 사진, 지도(OpenStreetMap), 저장·코스·기록·백업(이 기기 안).

## Supabase 서버 연결 후 동작하는 것
로그인·기기 간 동기화, 자동 수집·편집 검수를 거친 아카이브 프로젝트, 관리자 콘솔, 사진 업로드.

운영: 김지현 (JIHYUN KIM) · remona56@hanmail.net
