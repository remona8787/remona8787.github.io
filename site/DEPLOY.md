# 1-click에 가까운 Public Beta 배포

`site/` 폴더는 빌드 과정이 없는 정적 PWA다.

## 계정 없이 여기까지 완료됨
- 서울 검증 Seed
- installable PWA manifest/service worker
- 실제 OpenStreetMap 인터랙티브 지도
- 실제 Wikidata 전세계 검색
- 실제 Wikimedia Commons 이미지 라이선스 메타데이터 확인
- 저장/방문 localStorage
- privacy/about
- Netlify/Cloudflare Pages용 `_headers`
- Vercel config
- Dockerfile

## 공개 URL을 만드는 마지막 1단계
호스팅 계정 하나가 필요하다.

### Netlify / Cloudflare Pages
`site/` 폴더 전체를 정적 사이트로 배포. 빌드 명령 없음, publish directory는 site root.

### Vercel
site 폴더를 프로젝트 root로 업로드. Framework preset: Other.

### Docker
`docker build -t architecture-of-light .`
`docker run -p 8080:80 architecture-of-light`

## 스토어 앱과의 차이
이 PWA는 Android/desktop에서 브라우저의 “홈 화면에 추가/앱 설치”로 설치 가능하다.
Google Play/App Store 등록은 개발자 계정·서명·스토어 심사가 별도로 필요하다.

## Production 전 권장 교체
OpenStreetMap 공식 타일은 best-effort이며 상업/대규모 트래픽에 SLA가 없다.
정식 트래픽이 생기면 OSM 기반 상용 tile provider 또는 자체 호스팅으로 교체할 수 있도록 map tile URL을 config화할 것.


## v0.8 Hybrid Media
`config.js`에 Supabase URL/publishable key를 넣으면 `public_place_media`의 CDN 캐시 이미지가 live Commons보다 우선됩니다.
