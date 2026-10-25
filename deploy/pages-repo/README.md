# 빛의 건축 · Architecture of Light

A Korean platform of media facades, media art and architectural light, with the world's cases as a separate
section, served at **https://remona8787.github.io/**.

국내 미디어파사드·미디어아트·건축 조명 플랫폼이며, 세계의 사례를 별도 섹션으로 함께 다룹니다. 이 저장소가 곧 운영
백엔드입니다. GitHub Actions가 6시간마다 공개 출처(Wikidata, Wikimedia Commons, Wikipedia, 한국관광공사 TourAPI, Openverse,
Flickr 등)에서 프로젝트와 사진을 수집·정리·검증하고, 결과를 정적 데이터로 GitHub Pages에 배포합니다. 한국 출처를 먼저
수집합니다. 서버 비용은 0원입니다(공개 저장소의 Actions와 Pages는 무료).

## How it works

| branch | content | written by |
|---|---|---|
| `main` | the built site served by Pages, `data/` (the published dataset), this README, `.nojekyll` and `.github/workflows/archive.yml` | the `deploy` job only |
| `source` | the app (static PWA) and the pipeline at the branch root, `.github/workflows/archive.yml` (the same file as on `main`), plus `editorial/` (editor decisions) | people (and Claude) |
| `data` | pipeline output: `site-data/` (published), `admin-data/` (internal, never published), `review/` (contact sheets, query logs, live checks), `state/` (caches) | the workflow only |

`.github/workflows/archive.yml` runs every 6 hours (at minute 17, from `main`), on demand, and on every push to
`source` (from the copy on `source`). Runs never overlap and a running deploy is never cancelled:

1. **collect** (every schedule; on a push only when the commit message contains `[collect]`): runs
   `pipeline/run.mjs` of `source` and commits the result to `data`. A failed source never removes what it found
   before; a failed run commits nothing.
2. **deploy**: builds `source` with `SITE_URL=https://remona8787.github.io`, adds `data/` from the `data` branch and
   commits the result to `main` (this README, `.github/` and `.nojekyll` stay). GitHub Pages then publishes `main`.
   Internal admin data (`admin-data/`) is never copied to the site.
3. **verify-live**: waits until the live site serves that deploy (`/deploy.json`, `/data/manifest.json`), opens the
   main screens at phone and desktop sizes with Playwright and commits screenshots and measurements to
   `data:review/live/`.

The data comes from Wikidata (CC0), Wikipedia (links to articles), Wikimedia Commons, Korea Tourism Organization
TourAPI, Openverse and Flickr (every image keeps its own licence and author), and the archive's curated records. Only
facts with a source are published, and only images whose licence allows it.

## One-time setup

1. Settings → Pages → Build and deployment → Source: **Deploy from a branch**, branch `main`, folder `/ (root)`.
2. Settings → Actions → General → Workflow permissions: **Read and write permissions**.
3. Push the project to the `source` branch (the `light-architecture/` folder at the branch root, e.g.
   `git subtree split --prefix=light-architecture -b source` in the development repository, then
   `git push <this repository> source:source`).
4. Copy `deploy/pages-repo/.github/workflows/archive.yml`, `README.md` and `.nojekyll` of `source` to `main`.
   (`source` carries the same workflow at `.github/workflows/archive.yml`, so a push to `source` starts it.)
5. Optional keys, as repository secrets (Settings → Secrets and variables → Actions → New repository secret):
   `TOURAPI_SERVICE_KEY` (data.go.kr; TourAPI KorService2 and the tourism photo gallery), `FLICKR_API_KEY`,
   `OPENVERSE_CLIENT_ID` and `OPENVERSE_CLIENT_SECRET`, `UNSPLASH_ACCESS_KEY`, `PEXELS_API_KEY`, `NAVER_API_KEY_ID` and
   `NAVER_API_KEY`, `BRAVE_API_KEY`. Without a key that source is skipped; `docs/PIPELINE.md` says what each one adds.
6. Actions → archive → Run workflow (or push to `source` with `[collect]` in the commit message). The first run
   creates the `data` branch.

## Editing the archive

Editor decisions are JSON files in `editorial/decisions/` on `source` (approve, hide, unhide, merge, edit,
block_image, set_hero, unset_hero, approve_image, set_image) plus the reviewed hero list `editorial/hero.json`. The admin page
(https://remona8787.github.io/admin/) prepares a decision and opens GitHub's "create new file" page; only people with
write access to this repository can commit it. The next collect run applies it. See `docs/PIPELINE.md` on `source`.

The pipeline's internal data (run report, quality lists, candidates) stays on the `data` branch and is not part of the
site; the authenticated admin console is the optional Supabase mode.
