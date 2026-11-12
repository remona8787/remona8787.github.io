# 검색엔진 등록 (Google · 네이버 · Bing)

공개 주소 `https://remona8787.github.io/` 를 Google Search Console, 네이버 서치어드바이저, Bing 웹마스터 도구에 등록하는 방법.
등록(소유 확인·사이트맵 제출)은 운영자 계정으로만 할 수 있다. **등록은 색인이 아니다.** 등록 뒤 며칠~몇 주에 걸쳐 검색엔진이
페이지를 수집하고, 일부만 색인한다. 색인 수는 각 콘솔의 보고서로만 확인한다.

## 사이트가 이미 갖춘 것 (v1.0.0)

| 항목 | 내용 |
|---|---|
| robots.txt | 전체 허용, `/admin/`·`/data/admin/`만 제외, `Sitemap: https://remona8787.github.io/sitemap.xml` |
| sitemap.xml | 정적 페이지 8개 + 프로젝트 목록 `/p/` + 프로젝트마다 `/p/<id>/` (배포 때마다 공개 데이터로 다시 만듦) |
| 프로젝트 페이지 | `/p/<id>/` — 스크립트 없이 읽히는 HTML: 제목, 설명, canonical, OG, JSON-LD(작가가 밝혀진 작품은 `VisualArtwork`, 그 밖은 `CreativeWork` + 장소 + 사진 `ImageObject` + 이동 경로) |
| 첫 화면 | canonical, 설명, OG, `WebSite` JSON-LD, 바닥글의 일반 링크(프로젝트 목록 `/p/`, 서비스 소개) |
| 앱 화면 주소 | `#place/<id>` 같은 `#` 주소는 검색엔진이 따로 색인하지 않는다. 검색용 주소는 `/p/<id>/` 하나뿐이라 중복 제출이 없다 |

## 소유 확인 값 넣기 (공통)

GitHub Pages 주소(`*.github.io`)는 DNS를 운영자가 관리하지 않으므로 **HTML 태그(meta)** 방식을 쓴다.

1. 각 콘솔이 보여 주는 태그에서 `content="…"` 안의 값만 복사한다.
2. 그 값을 이 대화에 알려 주거나, 직접 `site-public-cleared/config.js`의 해당 줄에 넣는다:
   ```js
   GOOGLE_SITE_VERIFICATION: '여기에 값',
   NAVER_SITE_VERIFICATION: '여기에 값',
   BING_SITE_VERIFICATION: '여기에 값',
   ```
   소유 확인 값은 원래 누구나 볼 수 있는 공개 값이다(비밀키가 아니다). 비밀번호·API 키는 여기에 넣지 않는다.
3. `source`에 반영되면 배포가 `index.html`의 `<head>`에 `<meta name="google-site-verification">`,
   `<meta name="naver-site-verification">`, `<meta name="msvalidate.01">`를 **스크립트 없이** 넣는다(`scripts/build.mjs`).
4. 배포 후 https://remona8787.github.io/ 의 페이지 소스 보기에서 해당 meta가 보이면 콘솔에서 “확인”을 누른다.

HTML 파일 방식(`google<hex>.html`, `naver<hex>.html`)을 쓰려면 받은 파일을 `site-public-cleared/`에 그대로 넣는다. 빌드는 이 파일을 고치지 않고 배포한다.

## Google Search Console

1. https://search.google.com/search-console 에 운영자 Google 계정으로 로그인.
2. 속성 추가 → **URL 접두어** → `https://remona8787.github.io/` 입력 → 계속.
3. 확인 방법 **HTML 태그** → 값 복사 → 위 “소유 확인 값 넣기” → 배포 확인 후 **확인**.
4. 왼쪽 **Sitemaps** → `sitemap.xml` 입력 → 제출. 상태가 “성공”이고 발견된 URL 수가 sitemap 개수와 맞는지 본다.
5. **URL 검사**에 `https://remona8787.github.io/`와 대표 프로젝트(예: `https://remona8787.github.io/p/SEOUL006/`)를 넣고 “색인 생성 요청”.
6. 며칠 뒤 **페이지** 보고서: “색인이 생성됨” 수가 실제 색인 수다. “발견됨 – 현재 색인이 생성되지 않음”은 아직 색인이 아니다.

## 네이버 서치어드바이저

1. https://searchadvisor.naver.com/ → 웹마스터 도구 → 네이버 계정 로그인.
2. 사이트 등록에 `https://remona8787.github.io` 입력.
3. 소유 확인 **HTML 태그** → 값 복사 → “소유 확인 값 넣기” → 배포 확인 후 **소유확인**.
4. 요청 → **사이트맵 제출**: `https://remona8787.github.io/sitemap.xml`.
5. 검증 → **robots.txt** 검증으로 수집 허용 확인. 요청 → **웹 페이지 수집**에 첫 화면과 주요 프로젝트 주소를 넣는다.
6. 리포트 → 수집 현황·검색 노출에서 색인 상태를 본다. 순위나 노출은 보장되지 않는다.

## Bing 웹마스터 도구

1. https://www.bing.com/webmasters/ 로그인(Microsoft·Google 계정).
2. **Google Search Console에서 가져오기**를 고르면 Google 소유 확인과 사이트맵을 그대로 가져온다(Google을 먼저 마친 경우 가장 간단).
3. 따로 등록하면 사이트 추가 → **HTML Meta Tag** → 값을 `BING_SITE_VERIFICATION`에 넣고 배포 후 **Verify** → Sitemaps에 `sitemap.xml` 제출.
4. Site Explorer·URL Inspection으로 수집·색인 상태를 본다.

## 등록 후 점검

| 단계 | 확인 방법 | 상태 |
|---|---|---|
| 기술 준비 | 이 문서의 표, `npm test`(deploy·prerender 시험) | 저장소에서 확인 |
| 소유 확인 | 각 콘솔의 “확인됨” | 운영자 계정에서만 확인 가능 |
| 사이트맵 제출 | 콘솔의 사이트맵 상태 “성공” | 운영자 계정 |
| 수집 | 콘솔의 크롤링 통계·수집 현황 | 운영자 계정 |
| 색인 | Google “페이지” 보고서, 네이버 리포트, Bing Site Explorer, `site:remona8787.github.io` 검색 | 며칠~몇 주 뒤 |

키워드 반복이나 숨긴 문구로 순위를 올리려 하지 않는다. 같은 내용의 주소를 여러 개 제출하지 않는다(`#` 주소는 제출하지 않는다).
