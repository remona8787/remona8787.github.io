# 배포

배포 대상은 항상 빌드 결과물 `dist/`입니다. `site-public-cleared/`를 그대로 올리면 로그인·동기화 번들(`assets/cloud.js`, `assets/supabase.js`)과 지도 라이브러리(`assets/vendor/leaflet`)가 빠집니다.

    npm ci && npm run build      # → dist/

- **GitHub Pages** (https://remona8787.github.io, 사용자 사이트 = 사이트 루트): `SITE_URL=https://remona8787.github.io npm run build`
  후 `dist/` 내용을 Pages 브랜치의 루트에 올립니다(docs/STATIC_ARCHIVE.md의 `archive.yml` deploy 작업). Pages는 사용자 헤더를
  보낼 수 없으므로 빌드가 `_headers`의 Content-Security-Policy를 모든 페이지에 `<meta http-equiv>`로 넣고(frame-ancestors 제외),
  `.nojekyll`을 만듭니다. `404.html`은 루트 기준 경로(`/styles.css`)를 써서 어느 깊이의 없는 주소에서도 보이고, `sw.js`는 사이트
  루트 범위로 등록됩니다. `SITE_URL`은 https 사이트 루트여야 합니다(하위 경로 불가). `config.js`의 `PUBLIC_URL`, `robots.txt`,
  `sitemap.xml`, canonical/og 주소가 `SITE_URL`로 바뀌고, Supabase 키는 건드리지 않습니다.
- **Netlify / Cloudflare Pages**: Git 연결 시 base `light-architecture`, build `npm run build`, publish `dist`. 수동 업로드는 `dist/` 폴더를 끌어다 놓기. 보안 헤더는 `_headers`가 적용됩니다.
- **Vercel**: Root `light-architecture`, Build `npm run build`, Output `dist`. 헤더는 `vercel.json`.
- **Docker**: `dist/`에서 `docker build -t architecture-of-light . && docker run -p 8080:80 architecture-of-light`.
- **ChatGPT Sites**: `.openai/hosting.json`이 `dist`를 가리킵니다.

배포 후 `AOL_TEST_URL=https://<주소> npm run e2e`로 실제 주소를 검증합니다(사진 디코드 포함).

OpenStreetMap 공식 타일은 SLA가 없습니다. 트래픽이 늘면 `config.js`의 `TILE_URL`을 상용 타일 제공자로 교체하세요.
